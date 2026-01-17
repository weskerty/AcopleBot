import { Worker } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import redis from 'redis';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class PluginHandler {
  constructor(envVars) {
    this.envVars = envVars;
    this.pluginMeta = new Map();
    this.activeWorkers = new Map();
    this.pluginsPath = path.join(__dirname, '..', 'plugins');
    
    const prefixValue = envVars.PREFIX || process.env.PREFIX || '.';
    this.prefix = (typeof prefixValue === 'string' && prefixValue.trim().length > 0 && prefixValue.trim().length < 10) ? prefixValue.trim() : '.';
    
    this.sudoUsers = ((envVars.SUDO_USERS || process.env.SUDO_USERS || '')).split(',').map(u => u.trim()).filter(u => u);
    this.routingRules = this.loadRules();
    this.redisClient = null;
    this.subscriberClient = null;
    this.watcher = null;
    this.reloadDebounce = new Map();
  }

  loadRules() {
    const rules = [];
    let i = 1;
    while (this.envVars[`REGLA_${i}`]) {
      const v = this.envVars[`REGLA_${i}`];
      const rule = { ruleId: `REGLA_${i}`, targets: [], isAll: false };
      const parts = v.split(',');

      for (const p of parts) {
        const t = p.trim();
        if (t.startsWith('all:')) {
          rule.isAll = true;
          const [, aId, cId, dir] = t.split(':');
          rule.targets.push({
            adapterId: aId.trim(),
            chatId: cId.trim(),
            direction: dir.trim()
          });
        } else {
          const seg = t.split(':');
          if (seg.length >= 3) {
            const aId = seg[0].trim();
            const cId = seg[1].trim();
            const dir = seg[2].trim();
            let chatId = cId, threadId = null;
            if (cId.includes('/')) [chatId, threadId] = cId.split('/');
            rule.targets.push({
              adapterId: aId,
              chatId,
              threadId: threadId || null,
              direction: dir
            });
          }
        }
      }
      rules.push(rule);
      i++;
    }
    return rules;
  }

  isInRuledChat(adapterId, chatId) {
    return this.routingRules.some(rule =>
      rule.targets.some(t =>
        t.adapterId === adapterId && t.chatId === chatId
      )
    );
  }

  async initialize() {
    console.log('🔌 Inicializando Plugin Handler...');
    console.log('📁 Ruta:', this.pluginsPath);
    console.log('⚙️  Prefijo:', this.prefix);
    console.log('👑 SUDO:', this.sudoUsers.length > 0 ? this.sudoUsers.join(', ') : 'Ninguno');
    console.log('');

    if (!fs.existsSync(this.pluginsPath)) {
      fs.mkdirSync(this.pluginsPath, { recursive: true });
    }

    await this.initializeRedis();
    await this.loadAllPluginsMeta();
    await this.subscribeToMessages();
    this.setupHotReload();

    console.log(`✅ Plugin Handler inicializado con ${this.pluginMeta.size} plugin(s)\n`);
  }

  async initializeRedis() {
    const host = this.envVars.VALKEY_HOST || 'localhost';
    const port = Number(this.envVars.VALKEY_PORT || 6379);

    const cfg = {
      socket: { 
        host, 
        port, 
        reconnectStrategy: r => r > 10 ? new Error('Max retries') : Math.min(100 * r, 3000) 
      }
    };

    this.redisClient = redis.createClient(cfg);
    this.subscriberClient = redis.createClient(cfg);

    this.redisClient.on('error', e => console.error('[PLUGINS] Redis Error:', e));
    this.subscriberClient.on('error', e => console.error('[PLUGINS] Redis Subscriber Error:', e));

    await Promise.all([
      this.redisClient.connect(),
      this.subscriberClient.connect()
    ]);
  }

  setupHotReload() {
    this.watcher = fs.watch(this.pluginsPath, async (eventType, filename) => {
      if (!filename || !filename.endsWith('.js')) return;

      const pluginPath = path.join(this.pluginsPath, filename);

      clearTimeout(this.reloadDebounce.get(filename));

      this.reloadDebounce.set(filename, setTimeout(async () => {
        if (fs.existsSync(pluginPath)) {
          await this.reloadPluginMeta(pluginPath);
        } else {
          await this.unloadPlugin(filename);
        }
        this.reloadDebounce.delete(filename);
      }, 300));
    });
  }

  async reloadPluginMeta(filePath) {
    const pluginName = path.basename(filePath, '.js');

    const oldWorker = this.activeWorkers.get(pluginName);
    if (oldWorker) {
      await oldWorker.terminate();
      this.activeWorkers.delete(pluginName);
    }

    await this.loadPluginMeta(filePath);
    console.log(`[PLUGINS] Nuevo Plugin: ${pluginName}.js`);
  }

  async unloadPlugin(filename) {
    const pluginName = path.basename(filename, '.js');

    const worker = this.activeWorkers.get(pluginName);
    if (worker) {
      await worker.terminate();
      this.activeWorkers.delete(pluginName);
    }

    this.pluginMeta.delete(pluginName);
    console.log(`[PLUGINS] Plugin eliminado: ${pluginName}.js`);
  }

  async loadAllPluginsMeta() {
    const files = fs.readdirSync(this.pluginsPath).filter(f => f.endsWith('.js'));

    if (files.length === 0) {
      console.log('[PLUGINS] ⚠️  No se encontraron plugins');
      return;
    }

    console.log(`[PLUGINS] 📦 ${files.length} plugin(s) encontrado(s):`);

    for (const file of files) {
      await this.loadPluginMeta(path.join(this.pluginsPath, file));
    }

    console.log('');
  }

  async loadPluginMeta(filePath) {
    try {
      const pluginName = path.basename(filePath, '.js');
      const content = fs.readFileSync(filePath, 'utf8');
      const metaMatch = content.match(/ABMetaInfo\s*\(\s*\{([^}]+)\}\s*\)/s);

      if (!metaMatch) return;

      const meta = this.parseMetaInfo('{' + metaMatch[1] + '}');
      if (!meta.pattern) return;

      const pattern = new RegExp(`^${this.escapeRegex(this.prefix)}${meta.pattern}$`, 'i');

      this.pluginMeta.set(pluginName, {
        name: pluginName,
        filePath,
        pattern,
        rawPattern: meta.pattern,
        meta
      });

      const sudoTag = meta.sudo ? '🔒 [SUDO]' : '';
      console.log(`[PLUGINS]   ✅ ${pluginName} → ${this.prefix}${meta.pattern} ${sudoTag}`);
    } catch (error) {
      console.error(`[PLUGINS] ❌ Error cargando ${path.basename(filePath)}:`, error.message);
    }
  }

  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  parseMetaInfo(str) {
    const meta = { pattern: '', url: '', sudo: false, desc: '', type: 'utilidad', deps: [] };

    const pattern = str.match(/pattern\s*:\s*['"`]([^'"`]+)['"`]/);
    if (pattern) meta.pattern = pattern[1];

    const url = str.match(/url\s*:\s*['"`]([^'"`]+)['"`]/);
    if (url) meta.url = url[1];

    const sudo = str.match(/sudo\s*:\s*(true|false)/);
    if (sudo) meta.sudo = sudo[1] === 'true';

    const desc = str.match(/desc\s*:\s*['"`]([^'"`]+)['"`]/);
    if (desc) meta.desc = desc[1];

    const type = str.match(/type\s*:\s*['"`]([^'"`]+)['"`]/);
    if (type) meta.type = type[1];

    const deps = str.match(/deps\s*:\s*\[([^\]]*)\]/);
    if (deps) {
      meta.deps = deps[1].split(',').map(d => d.trim().replace(/['"`]/g, '')).filter(d => d);
    }

    return meta;
  }

  async subscribeToMessages() {
    await this.subscriberClient.subscribe('bot.On.AdaptadorMessage', async (msg) => {
      try {
        const data = JSON.parse(msg);
        if (data.eventType === 'message' && data.author?.bot !== true && data.message?.text) {
          await this.handleMessage(data);
        }
      } catch (error) {
        console.error('[PLUGINS] ❌ Error procesando mensaje:', error.message);
      }
    });
  }

  async handleMessage(message) {
    const text = message.message.text.trim();
    if (!text.startsWith(this.prefix)) return;

    for (const [name, plugin] of this.pluginMeta) {
      const match = text.match(plugin.pattern);
      if (!match) continue;

      const userId = message.author.id;
      const adapterId = message.adapterId;
      const chatId = message.conversation.id;
      const args = match[1] !== undefined ? match[1].trim() : '';

      const hasSudoConfig = this.sudoUsers.length > 0;
      const isSudoUser = this.sudoUsers.includes(userId);
      const isRuledChat = this.isInRuledChat(adapterId, chatId);
      const isSetVar = name === 'setvar';

      let allowed = false;

      if (!hasSudoConfig && isSetVar) {
        allowed = true;
      } else if (hasSudoConfig) {
        if (plugin.meta.sudo) {
          allowed = isSudoUser;
        } else {
          allowed = isRuledChat || isSudoUser;
        }
      } else {
        allowed = false;
      }

      if (!allowed) {
        console.log(`${userId} negado a ${name} con "${args}"`);
        return;
      }

      console.log(`${userId} ejecuto ${name} con "${args}"`);

      const worker = await this.getOrCreateWorker(name, plugin);
      const fullContext = await this.getFullContext(message);

      worker.postMessage({
        message,
        args,
        fullContext
      });

      return;
    }
  }

  async getOrCreateWorker(pluginName, plugin) {
    if (this.activeWorkers.has(pluginName)) {
      return this.activeWorkers.get(pluginName);
    }

    const worker = new Worker(plugin.filePath, { env: this.envVars });

    worker.on('message', msg => this.handleWorkerMessage(pluginName, msg));
    worker.on('error', err => console.error(`[PLUGINS] ❌ Error en worker ${pluginName}:`, err));
    worker.on('exit', code => {
      this.activeWorkers.delete(pluginName);
      if (code !== 0) {
        console.error(`[PLUGINS] ❌ Worker ${pluginName} terminó con código ${code}`);
      }
    });

    this.activeWorkers.set(pluginName, worker);

    return worker;
  }

  async getFullContext(message) {
    try {
      if (message.message?.replyTo?.universalId) {
        const replyMsg = await this.getMessageByUniversalId(message.message.replyTo.universalId);
        if (replyMsg) {
          return {
            ...message,
            message: {
              ...message.message,
              replyTo: replyMsg
            }
          };
        }
      }
      return message;
    } catch (error) {
      console.error('[PLUGINS] Error obteniendo contexto:', error.message);
      return message;
    }
  }

  async getMessageByUniversalId(universalId) {
    try {
      const loc = await this.redisClient.get(`idx:u2loc:${universalId}`);
      if (!loc) return null;

      const [aId, cId] = loc.split(':');
      const data = await this.redisClient.hGet(`msg:${aId}:${cId}:u:${universalId}`, 'd');

      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('[PLUGINS] Error buscando mensaje:', error.message);
      return null;
    }
  }

  async handleWorkerMessage(pluginName, msg) {
    if (msg.type === 'log') {
      console.log(`[${pluginName.toUpperCase()}] ${msg.message}`);
    } else if (msg.type === 'response') {
      await this.publishResponse(pluginName, msg.originalMessage, msg.response);
    } else if (msg.type === 'error') {
      console.error(`[${pluginName.toUpperCase()}] ❌ ${msg.message}`);
    }
  }

  async publishResponse(pluginName, originalMessage, response) {
    try {
      const msg = {
        universalId: crypto.randomUUID(),
        timestamp: Date.now(),
        platform: originalMessage.platform,
        adapterId: originalMessage.adapterId,
        eventType: 'message',
        server: originalMessage.server,
        conversation: originalMessage.conversation,
        thread: originalMessage.thread,
        author: {
          id: 'webUser',
          username: 'webUser',
          displayName: 'Web User',
          avatarUrl: null,
          avatarPath: null,
          bot: true
        },
        message: {
          id: crypto.randomUUID(),
          text: response.text || response,
          textFormatted: null,
          replyTo: {
            messageId: originalMessage.message.id,
            universalId: originalMessage.universalId,
            text: originalMessage.message.text.substring(0, 100),
            author: originalMessage.author
          },
          edited: false,
          pinned: false
        },
        attachments: response.attachments || null,
        reaction: null,
        socialEvent: null,
        configChange: null,
        apiCall: response.apiCall || null,
        raw: {},
        isPluginResponse: true
      };

      await this.redisClient.publish('bot.On.AdaptadorMessage', JSON.stringify(msg));
    } catch (error) {
      console.error(`[PLUGINS] ❌ Error publicando respuesta de ${pluginName}:`, error.message);
    }
  }

  async shutdown() {
    console.log('[PLUGINS] 🛑 Cerrando...');

    if (this.watcher) {
      this.watcher.close();
    }

    for (const [name, worker] of this.activeWorkers) {
      try {
        await worker.terminate();
      } catch (error) {
        console.error(`[PLUGINS] ❌ Error cerrando ${name}:`, error.message);
      }
    }

    if (this.redisClient) await this.redisClient.quit();
    if (this.subscriberClient) await this.subscriberClient.quit();
  }
}

export default PluginHandler;