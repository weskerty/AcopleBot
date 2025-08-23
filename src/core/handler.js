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
        this.cleanupInterval = null;
        this.redisClient = null;
    }

    async initializeRedis() {
        const VALKEY_HOST = this.envVars.VALKEY_HOST || process.env.VALKEY_HOST;
        const VALKEY_PORT = Number(this.envVars.VALKEY_PORT || process.env.VALKEY_PORT);
        
        this.redisClient = redis.createClient({
            socket: {
                host: VALKEY_HOST,
                port: VALKEY_PORT
            }
        });

        this.redisClient.on('error', (error) => {
            console.error('Redis Error:', error);
        });

        await this.redisClient.connect();
        console.log('✅ Conectado a Redis para limpieza');
    }

    async cleanupRedisData() {
        if (!this.redisClient) return;
        
        try {            
            await this.redisClient.del('history:global');
            console.log('✅ Historial global eliminado');
            
            const indexKeys = await this.redisClient.keys('index:universal:*');
            if (indexKeys.length > 0) {
                await this.redisClient.del(indexKeys);
                console.log(`✅ ${indexKeys.length} índices de mensajes eliminados`);
            }
            
            const platformIndexKeys = await this.redisClient.keys('index:platform:*');
            if (platformIndexKeys.length > 0) {
                await this.redisClient.del(platformIndexKeys);
                console.log(`✅ ${platformIndexKeys.length} índices de plataforma eliminados`);
            }
            
            console.log('🧹 Limpieza completada');
        } catch (error) {
            console.error('❌ Error durante la limpieza:', error);
        }
    }

    setupCleanupInterval() {
        const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
        
        this.cleanupInterval = setInterval(async () => {
            await this.cleanupRedisData();
        }, TWENTY_FOUR_HOURS);
    }

    async initialize() {
        console.log('🔍:', this.adaptersPath);
        
        if (!fs.existsSync(this.adaptersPath)) {
            throw new Error(`La carpeta de adaptadores no existe: ${this.adaptersPath}`);
        }

        await this.initializeRedis();
        await this.cleanupRedisData();
        this.setupCleanupInterval();

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
                cwd: path.dirname(filePath)
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
            restarts: existing ? existing.restarts : 0
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
            console.log(`${color}${prefix}\x1b[0m ❌ Proceso terminado con código: ${code} (señal: ${signal})`);
            this.handleFailure(adapterName, adapter, color, prefix);
        }
    }

    handleProcessError(adapterName, error, color, prefix) {
        console.error(`${color}${prefix}\x1b[0m 💥 Error del proceso:`, error);
        
        const adapter = this.adapters.get(adapterName);
        if (adapter) {
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
            const retryReason = reason === 'error' ? 'por error' : '';
            console.log(`${color}${prefix}\x1b[0m 🔄 Reintentando ${retryReason}... (intento ${adapter.restarts}/${this.maxRetries})`);
            
            setTimeout(() => {
                if (!this.isShuttingDown) {
                    this.loadAdapter(adapter.filePath);
                }
            }, 2000 * adapter.restarts);
        } else {
            console.log(`${color}${prefix}\x1b[0m 🛑 Adaptador deshabilitado por exceso de fallos 🛑`);
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
        
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        
        if (this.redisClient) {
            this.redisClient.quit().catch(console.error);
        }
        
        const adaptersArray = Array.from(this.adapters.entries());
        
        if (adaptersArray.length === 0) {
            console.log('✅ Nada que Cerrar');
            process.exit(0);
        }

        console.log(`🔄 Cerrando ${adaptersArray.length}...`);
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
        return uptime < 60 ? `${uptime}s` : `${Math.floor(uptime/60)}m ${uptime%60}s`;
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
        
        return new Promise(() => {}); 
        
    } catch (error) {
        console.error('💥', error);
        throw error;
    }
}