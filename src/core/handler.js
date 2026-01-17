import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import redis from 'redis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class AdapterHandler {
  constructor(envVars) {
    this.envVars = envVars;
    this.adapters = new Map();
    this.adaptersPath = path.join(__dirname, '..', 'adapters');
    this.isShuttingDown = false;
    this.maxRetries = 5;
    this.shutdownTimeout = 20000;
    this.killTimeout = 5000;
    this.redisClient = null;
  }

  async initializeRedis() {
    const VALKEY_HOST = this.envVars.VALKEY_HOST || process.env.VALKEY_HOST || 'localhost';
    const VALKEY_PORT = Number(this.envVars.VALKEY_PORT || process.env.VALKEY_PORT || 6379);

    this.redisClient = redis.createClient({
      socket: {
        host: VALKEY_HOST,
        port: VALKEY_PORT,
        reconnectStrategy: r => r > 10 ? new Error('Max retries') : Math.min(100 * r, 3000)
      }
    });

    this.redisClient.on('error', (error) => {
      console.error('Redis Error:', error);
    });

    await this.redisClient.connect();
    console.log('✅ Conectado a KV');
  }

  async getRedisStats() {
    if (!this.redisClient) return null;

    try {
      const keys = await this.redisClient.keys('msg:*:*:u:*');
      const statsKeys = await this.redisClient.keys('stats:*');
      
      let totalMessages = 0;
      const chatStats = [];

      for (const key of statsKeys) {
        const stats = await this.redisClient.hGetAll(key);
        const [, aId, cId] = key.split(':');
        
        chatStats.push({
          chat: `${aId}:${cId}`,
          count: parseInt(stats.count || 0),
          lastMsg: parseInt(stats.last || 0)
        });
        
        totalMessages += parseInt(stats.count || 0);
      }

      return {
        totalMessages,
        totalKeys: keys.length,
        chatStats
      };
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas:', error);
      return null;
    }
  }

  async cleanupRedisData() {
    if (!this.redisClient) return;

    const MAX_MESSAGES_PER_CHAT = this.envVars.REDIS_MAX_MESSAGES_PER_CHAT || 
                                   process.env.REDIS_MAX_MESSAGES_PER_CHAT;

    if (!MAX_MESSAGES_PER_CHAT) {
      console.log('ℹ️  Limpieza automática deshabilitada (sin límites configurados)');
      return;
    }

    const maxMsgs = parseInt(MAX_MESSAGES_PER_CHAT);

    try {
      const statsKeys = await this.redisClient.keys('stats:*');
      
      for (const statKey of statsKeys) {
        const [, aId, cId] = statKey.split(':');
        const stats = await this.redisClient.hGetAll(statKey);
        const count = parseInt(stats.count || 0);

        if (count <= maxMsgs) continue;

        console.log(`🧹 Limpiando ${aId}:${cId} (${count} > ${maxMsgs})`);

        const toRemove = count - maxMsgs;
        const k = `msg:${aId}:${cId}`;
        
        const allUids = await this.redisClient.keys(`${k}:u:*`);
        
        const uidsWithTs = [];
        for (const uidKey of allUids) {
          const data = await this.redisClient.hGet(uidKey, 'd');
          if (data) {
            const msg = JSON.parse(data);
            uidsWithTs.push({
              uid: msg.universalId,
              ts: msg.timestamp,
              pId: msg.message?.id
            });
          }
        }

        uidsWithTs.sort((a, b) => a.ts - b.ts);
        const toDelete = uidsWithTs.slice(0, toRemove);

        const p = this.redisClient.multi();

        for (const item of toDelete) {
          p.del(`${k}:u:${item.uid}`);
          if (item.pId) {
            p.del(`${k}:p2u:${item.pId}`);
            p.del(`${k}:u2p:${item.uid}`);
          }
          p.del(`idx:u2loc:${item.uid}`);
        }

        p.hSet(statKey, 'count', maxMsgs);

        await p.exec();

        console.log(`✅ Eliminados ${toRemove} mensajes antiguos de ${aId}:${cId}`);
      }

      console.log('🧹 Limpieza completada');
    } catch (error) {
      console.error('❌ Error durante la limpieza:', error);
    }
  }

  async showRedisInfo() {
    const stats = await this.getRedisStats();
    if (!stats) return;

    console.log('\n📊 Información de Redis:');
    console.log(`   Total de mensajes: ${stats.totalMessages}`);
    console.log(`   Total de claves: ${stats.totalKeys}`);
    
    if (stats.chatStats.length > 0) {
      console.log('\n   Por chat:');
      for (const chat of stats.chatStats) {
        const lastDate = chat.lastMsg ? new Date(chat.lastMsg).toLocaleString() : 'N/A';
        console.log(`     ${chat.chat}: ${chat.count} msgs (último: ${lastDate})`);
      }
    }
    console.log('');
  }

  async disconnectRedis() {
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
        console.log('✅ Desconectado de Redis');
      } catch (error) {
        console.error('❌ Error desconectando Redis:', error);
      }
    }
  }

  async initialize() {
    console.log('📁:', this.adaptersPath);

    if (!fs.existsSync(this.adaptersPath)) {
      throw new Error(`La carpeta de adaptadores no existe: ${this.adaptersPath}`);
    }

    await this.initializeRedis();
    await this.showRedisInfo();
    await this.cleanupRedisData();
    await this.disconnectRedis();

    const files = this.getAdapterFiles();
    if (files.length === 0) {
      console.log('⚠️  No hay Adaptadores');
      return;
    }

    this.logFoundAdapters(files);
    await this.loadAllAdapters(files);
    this.setupSignalHandlers();
  }

  getAdapterFiles() {
    return fs.readdirSync(this.adaptersPath)
      .filter(file => file.endsWith('.js'))
      .map(file => path.join(this.adaptersPath, file));
  }

  logFoundAdapters(files) {
    console.log(`📱 ${files.length}:`);
    files.forEach(file => {
      const adapterName = path.basename(file, '.js');
      console.log(`   - ${adapterName}.js`);
    });
    console.log('');
  }

  async loadAllAdapters(files) {
    for (const filePath of files) {
      await this.loadAdapter(filePath);
    }
  }

  async loadAdapter(filePath) {
    const adapterName = path.basename(filePath, '.js');

    try {
      console.log(`🚀 Iniciando ${adapterName}`);

      const child = spawn('node', [filePath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...this.envVars },
        cwd: process.cwd()
      });

      this.registerAdapter(adapterName, child, filePath);
      this.setupChildProcess(child, adapterName);

      console.log(`✅ Adaptador ${adapterName} iniciado (PID: ${child.pid})`);

    } catch (error) {
      console.error(`❌ Error cargando adaptador ${adapterName}:`, error);
    }
  }

  registerAdapter(adapterName, child, filePath) {
    const existing = this.adapters.get(adapterName);
    this.adapters.set(adapterName, {
      process: child,
      filePath,
      startTime: Date.now(),
      restarts: existing ? existing.restarts : 0,
      lastError: null
    });
  }

  setupChildProcess(child, adapterName) {
    const { color, prefix } = this.getAdapterStyle(adapterName);

    child.stdout.on('data', (data) => this.handleOutput(data, prefix, color));
    child.stderr.on('data', (data) => this.handleError(data, prefix, color));
    child.on('close', (code, signal) => this.handleProcessClose(adapterName, code, signal, color, prefix));
    child.on('error', (error) => this.handleProcessError(adapterName, error, color, prefix));
    child.on('disconnect', () => console.log(`${color}${prefix}\x1b[0m 🔌 Proceso desconectado`));
  }

  getAdapterStyle(adapterName) {
    const colorMap = {
      'telegram': '\x1b[36m',
      'whatsapp': '\x1b[32m',
      'discord': '\x1b[35m',
      'slack': '\x1b[33m',
      'web': '\x1b[34m',
      'default': '\x1b[37m'
    };
    return {
      color: colorMap[adapterName.toLowerCase()] || colorMap.default,
      prefix: `[${adapterName.toUpperCase()}]`
    };
  }

  handleOutput(data, prefix, color) {
    const output = data.toString().trim();
    if (output) {
      output.split('\n').forEach(line => {
        if (line.trim()) {
          console.log(`${color}${prefix}\x1b[0m ${line}`);
        }
      });
    }
  }

  handleError(data, prefix, color) {
    const output = data.toString().trim();
    if (output) {
      output.split('\n').forEach(line => {
        if (line.trim()) {
          console.error(`${color}${prefix}\x1b[0m 🔴 ${line}`);
        }
      });
    }
  }

  handleProcessClose(adapterName, code, signal, color, prefix) {
    const adapter = this.adapters.get(adapterName);
    if (!adapter) return;

    if (code === 0) {
      console.log(`${color}${prefix}\x1b[0m ✅ Proceso terminado correctamente`);
      this.adapters.delete(adapterName);
    } else {
      this.handleFailure(adapterName, adapter, color, prefix);
    }
  }

  handleProcessError(adapterName, error, color, prefix) {
    const adapter = this.adapters.get(adapterName);
    if (adapter) {
      adapter.lastError = error.message;
      this.handleFailure(adapterName, adapter, color, prefix, 'error');
    }
  }

  handleFailure(adapterName, adapter, color, prefix, reason = 'close') {
    if (this.isShuttingDown) {
      this.adapters.delete(adapterName);
      return;
    }

    if (adapter.restarts < this.maxRetries) {
      adapter.restarts++;

      setTimeout(() => {
        if (!this.isShuttingDown) {
          this.loadAdapter(adapter.filePath);
        }
      }, 2000 * adapter.restarts);
    } else {
      const errorMsg = adapter.lastError ? ` (Último error: ${adapter.lastError})` : '';
      console.log(`${color}${prefix}\x1b[0m 🛑 Adaptador deshabilitado tras ${this.maxRetries} intentos fallidos${errorMsg}`);
      this.adapters.delete(adapterName);
    }
  }

  setupSignalHandlers() {
    const shutdown = (signal) => this.shutdown(signal);
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  shutdown(signal) {
    console.log(`\n🛑 Recibido ${signal}. Cerrando...`);
    this.isShuttingDown = true;

    const adaptersArray = Array.from(this.adapters.entries());

    if (adaptersArray.length === 0) {
      console.log('✅ Nada que Cerrar');
      process.exit(0);
    }

    console.log(`🔄 Cerrando ${adaptersArray.length} adaptador(es)...`);
    this.gracefulShutdown(adaptersArray);
  }

  gracefulShutdown(adaptersArray) {
    let closedCount = 0;
    const timeout = setTimeout(() => {
      console.log('⏰ Forzando cierre...');
      process.exit(1);
    }, this.shutdownTimeout);

    const onAdapterClosed = (name) => {
      closedCount++;
      console.log(`✅ ${name} cerrado (${closedCount}/${adaptersArray.length})`);

      if (closedCount >= adaptersArray.length) {
        clearTimeout(timeout);
        console.log('✅ Cerrado.');
        process.exit(0);
      }
    };

    adaptersArray.forEach(([name, adapter]) => {
      this.shutdownAdapter(name, adapter.process, onAdapterClosed);
    });
  }

  shutdownAdapter(name, child, onClosed) {
    child.once('close', () => onClosed(name));

    if (child.killed) {
      onClosed(name);
      return;
    }

    console.log(`🔄 Cerrando adaptador ${name} (PID: ${child.pid})...`);
    child.kill('SIGTERM');

    setTimeout(() => {
      if (!child.killed) {
        console.log(`⚡ Forzando ${name}...`);
        child.kill('SIGKILL');
      }
    }, this.killTimeout);
  }

  getStatus() {
    const adaptersArray = Array.from(this.adapters.entries());

    console.log('\n📊 Estado de adaptadores:');
    if (adaptersArray.length === 0) {
      console.log('No hay adaptadores');
      return;
    }

    adaptersArray.forEach(([name, adapter]) => {
      const uptime = Math.floor((Date.now() - adapter.startTime) / 1000);
      const uptimeStr = this.formatUptime(uptime);
      const status = adapter.process.killed ? '❌ Muerto' : '✅ Activo';

      console.log(`   ${name}: ${status} (PID: ${adapter.process.pid}, Tiempo: ${uptimeStr}, Reintentos: ${adapter.restarts})`);
    });
    console.log('');
  }

  formatUptime(uptime) {
    return uptime < 60 ? `${uptime}s` : `${Math.floor(uptime / 60)}m ${uptime % 60}s`;
  }
}

export default async function handler(envVars = {}) {
  const adapterHandler = new AdapterHandler(envVars);

  try {
    await adapterHandler.initialize();

    if (process.env.NODE_ENV === 'development') {
      setInterval(() => adapterHandler.getStatus(), 30000);
    }

    console.log('🔄 Presiona Ctrl+C para salir.');

    return new Promise(() => { });

  } catch (error) {
    console.error('💥', error);
    throw error;
  }
}