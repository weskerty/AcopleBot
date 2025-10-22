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
        this.plugins = new Map();
        this.workers = new Map();
        this.pluginsPath = path.join(__dirname, '..', 'plugins');
        this.prefix = envVars.PREFIX || '.';
        this.sudoUsers = (envVars.SUDO_USERS || '').split(',').map(id => id.trim()).filter(id => id);
        this.redisClient = null;
        this.subscriberClient = null;
    }

    async initialize() {
        console.log('🔌 Inicializando Plugin Handler...');
        console.log('📁 Ruta de plugins:', this.pluginsPath);
        console.log('⚙️  Prefijo configurado:', this.prefix);
        console.log('👑 Usuarios SUDO:', this.sudoUsers.length > 0 ? this.sudoUsers.join(', ') : 'Ninguno');
        console.log('');
        
        if (!fs.existsSync(this.pluginsPath)) {
            console.log('⚠️  Carpeta de plugins no existe, creando...');
            fs.mkdirSync(this.pluginsPath, { recursive: true });
        }

        await this.initializeRedis();
        await this.loadAllPlugins();
        await this.subscribeToMessages();
        
        console.log(`✅ Plugin Handler inicializado con ${this.plugins.size} plugin(s)\n`);
    }

    async initializeRedis() {
        const VALKEY_HOST = this.envVars.VALKEY_HOST;
        const VALKEY_PORT = Number(this.envVars.VALKEY_PORT);
        
        this.redisClient = redis.createClient({
            socket: {
                host: VALKEY_HOST,
                port: VALKEY_PORT,
                reconnectStrategy: (retries) => {
                    if (retries > 10) {
                        console.error('[PLUGINS] Redis: Demasiados intentos de reconexión');
                        return new Error('Conexión perdida permanentemente');
                    }
                    const delay = Math.min(retries * 100, 3000);
                    return delay;
                }
            }
        });
        
        this.subscriberClient = redis.createClient({
            socket: {
                host: VALKEY_HOST,
                port: VALKEY_PORT,
                reconnectStrategy: (retries) => {
                    if (retries > 10) return new Error('Max retries');
                    return Math.min(retries * 100, 3000);
                }
            }
        });

        this.redisClient.on('error', (err) => console.error('[PLUGINS] Redis Error:', err));
        this.subscriberClient.on('error', (err) => console.error('[PLUGINS] Redis Subscriber Error:', err));
        
        await Promise.all([
            this.redisClient.connect(),
            this.subscriberClient.connect()
        ]);
        
        console.log('[PLUGINS] ✅ Conectado a Redis');
    }

    async loadAllPlugins() {
        const files = fs.readdirSync(this.pluginsPath)
            .filter(file => file.endsWith('.js'));
        
        if (files.length === 0) {
            console.log('[PLUGINS] ⚠️  No se encontraron plugins en:', this.pluginsPath);
            return;
        }

        console.log(`[PLUGINS] 📦 ${files.length} plugin(s) encontrado(s):`);
        
        for (const file of files) {
            await this.loadPlugin(path.join(this.pluginsPath, file));
        }
        
        console.log('');
    }

    async loadPlugin(filePath) {
        try {
            const pluginName = path.basename(filePath, '.js');
            const content = fs.readFileSync(filePath, 'utf8');
            
            const metaMatch = content.match(/ABMetaInfo\s*\(\s*\{([^}]+)\}\s*\)/s);
            if (!metaMatch) {
                console.log(`[PLUGINS] ⚠️  ${pluginName}: No tiene ABMetaInfo, omitiendo`);
                return;
            }
            
            const metaStr = '{' + metaMatch[1] + '}';
            const meta = this.parseMetaInfo(metaStr);
            
            if (!meta.pattern) {
                console.log(`[PLUGINS] ⚠️  ${pluginName}: No tiene pattern definido`);
                return;
            }
            

            const patternRegex = new RegExp(`^${this.escapeRegex(this.prefix)}${meta.pattern}$`, 'i');
            

            const worker = new Worker(filePath, {
                env: this.envVars
            });

            worker.on('message', (data) => this.handleWorkerMessage(pluginName, data));
            worker.on('error', (err) => console.error(`[PLUGINS] ❌ Error en worker ${pluginName}:`, err));
            worker.on('exit', (code) => {
                if (code !== 0) {
                    console.error(`[PLUGINS] ❌ Worker ${pluginName} terminó con código ${code}`);
                }
            });

            this.plugins.set(pluginName, {
                name: pluginName,
                filePath,
                pattern: patternRegex,
                rawPattern: meta.pattern,
                meta,
                worker
            });
            
            this.workers.set(pluginName, worker);
            
            const sudoTag = meta.sudo ? '🔒 [SUDO]' : '';
            console.log(`[PLUGINS]   ✅ ${pluginName} → ${this.prefix}${meta.pattern} ${sudoTag}`);
            
        } catch (err) {
            console.error(`[PLUGINS] ❌ Error cargando ${path.basename(filePath)}:`, err.message);
        }
    }

    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    parseMetaInfo(metaStr) {
        const meta = {
            pattern: '',
            url: '',
            sudo: false,
            desc: '',
            type: 'utilidad',
            deps: []
        };

        const patternMatch = metaStr.match(/pattern\s*:\s*['"`]([^'"`]+)['"`]/);
        if (patternMatch) meta.pattern = patternMatch[1];

        const urlMatch = metaStr.match(/url\s*:\s*['"`]([^'"`]+)['"`]/);
        if (urlMatch) meta.url = urlMatch[1];

        const sudoMatch = metaStr.match(/sudo\s*:\s*(true|false)/);
        if (sudoMatch) meta.sudo = sudoMatch[1] === 'true';

        const descMatch = metaStr.match(/desc\s*:\s*['"`]([^'"`]+)['"`]/);
        if (descMatch) meta.desc = descMatch[1];

        const typeMatch = metaStr.match(/type\s*:\s*['"`]([^'"`]+)['"`]/);
        if (typeMatch) meta.type = typeMatch[1];

        const depsMatch = metaStr.match(/deps\s*:\s*\[([^\]]*)\]/);
        if (depsMatch) {
            meta.deps = depsMatch[1]
                .split(',')
                .map(d => d.trim().replace(/['"`]/g, ''))
                .filter(d => d);
        }

        return meta;
    }

    async subscribeToMessages() {
        console.log('[PLUGINS] 👂 Escuchando canal: bot.On.AdaptadorMessage\n');
        
        await this.subscriberClient.subscribe('bot.On.AdaptadorMessage', async (message) => {
            try {
                const msg = JSON.parse(message);
                

                if (msg.eventType !== 'message') return;
                

                if (msg.author?.bot === true) return;
                

                if (!msg.message?.text) return;
                
                await this.handleMessage(msg);
            } catch (err) {
                console.error('[PLUGINS] ❌ Error procesando mensaje:', err.message);
            }
        });
    }

    async handleMessage(msg) {
        const text = msg.message.text.trim();
        

        if (!text.startsWith(this.prefix)) return;
        
        console.log(`[PLUGINS] 📥 Mensaje recibido: "${text}"`);
        

        for (const [name, plugin] of this.plugins) {
            const match = text.match(plugin.pattern);
            
            if (match) {
                console.log(`[PLUGINS] ✅ Match encontrado con: ${name}`);
                
                // Verificar permisos sudo
                if (plugin.meta.sudo === true) {
                    const userId = msg.author.id;
                    if (!this.sudoUsers.includes(userId)) {
                        console.log(`[PLUGINS] 🔒 Acceso denegado para usuario: ${userId}`);
                        await this.sendErrorResponse(msg, '⛔ No tienes permisos para usar este comando');
                        return;
                    }
                }
                

                const args = match[1] !== undefined ? match[1].trim() : '';
                
                console.log(`[PLUGINS] 🎯 Ejecutando: ${name} | Args: "${args}"`);
                

                plugin.worker.postMessage({
                    message: msg,
                    args: args
                });
                
                return; 
            }
        }
        
        console.log(`[PLUGINS] ⚠️  Ningún plugin coincide con: "${text}"`);
    }

    async handleWorkerMessage(pluginName, data) {
        if (data.type === 'log') {
            console.log(`[${pluginName.toUpperCase()}] ${data.message}`);
        } else if (data.type === 'response') {
            await this.publishResponse(pluginName, data.originalMessage, data.response);
        } else if (data.type === 'error') {
            console.error(`[${pluginName.toUpperCase()}] ❌ ${data.message}`);
        }
    }

async publishResponse(pluginName, originalMessage, response) {
    try {
        const universalMessage = {
            universalId: crypto.randomUUID(),
            timestamp: Date.now(),
            platform: originalMessage.platform,
            adapterId: originalMessage.adapterId,
            eventType: 'message',
            server: originalMessage.server,
            conversation: originalMessage.conversation,
            thread: originalMessage.thread,
            author: {
                id: 'bot_plugin',         
                username: 'bot',
                displayName: 'Bot',
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
            apiCall: null,
            raw: {},
            isPluginResponse: true 
        };

        await this.redisClient.publish('bot.On.AdaptadorMessage', JSON.stringify(universalMessage));
        console.log(`[${pluginName.toUpperCase()}] ✅ Respuesta enviada`);
        
    } catch (err) {
        console.error(`[PLUGINS] ❌ Error publicando respuesta de ${pluginName}:`, err.message);
    }
}

    async sendErrorResponse(msg, errorText) {
        try {
            const universalMessage = {
                universalId: crypto.randomUUID(),
                timestamp: Date.now(),
                platform: msg.platform,
                adapterId: msg.adapterId,
                eventType: 'message',
                server: msg.server,
                conversation: msg.conversation,
                thread: msg.thread,
                author: {
                    id: 'system',
                    username: 'bot',
                    displayName: 'Bot',
                    avatarUrl: null,
                    avatarPath: null,
                    bot: true
                },
                message: {
                    id: crypto.randomUUID(),
                    text: errorText,
                    textFormatted: null,
                    replyTo: {
                        messageId: msg.message.id,
                        universalId: msg.universalId,
                        text: msg.message.text.substring(0, 100),
                        author: msg.author
                    },
                    edited: false,
                    pinned: false
                },
                attachments: null,
                reaction: null,
                socialEvent: null,
                configChange: null,
                apiCall: null,
                raw: {}
            };

            await this.redisClient.publish('bot.On.AdaptadorMessage', JSON.stringify(universalMessage));
            
        } catch (err) {
            console.error('[PLUGINS] ❌ Error enviando mensaje de error:', err.message);
        }
    }

    async shutdown() {
        console.log('[PLUGINS] 🛑 Cerrando Plugin Handler...');
        
        for (const [name, worker] of this.workers) {
            try {
                await worker.terminate();
                console.log(`[PLUGINS] ✅ ${name} cerrado`);
            } catch (err) {
                console.error(`[PLUGINS] ❌ Error cerrando ${name}:`, err.message);
            }
        }
        
        if (this.redisClient) await this.redisClient.quit();
        if (this.subscriberClient) await this.subscriberClient.quit();
        
        console.log('[PLUGINS] ✅ Plugin Handler cerrado');
    }
}

export default PluginHandler;