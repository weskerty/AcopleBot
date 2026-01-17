import fs from 'fs';
import 'dotenv/config';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import os from 'os';
import gradient from 'gradient-string';
import { rainbow, instagram, cristal } from 'gradient-string';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let isRunning = false;

function startBanner() {
    if (isRunning) return;
    isRunning = true;

    console.log(instagram(' █████╗  ██████╗ ██████╗ ██████╗ ██╗     ███████╗'));
    console.log(instagram('██╔══██╗██╔════╝██╔═══██╗██╔══██╗██║     ██╔════╝'));
    console.log(instagram('███████║██║     ██║   ██║██████╔╝██║     █████╗  '));
    console.log(instagram('██╔══██║██║     ██║   ██║██╔═══╝ ██║     ██╔══╝  '));
    console.log(instagram('██║  ██║╚██████╗╚██████╔╝██║     ███████╗███████╗'));
    console.log(instagram('╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝     ╚══════╝╚══════╝'));
    console.log(gradient(['red', 'magenta'])('Bot Comunitario'));
    console.log('');
}

function getSystemInfo() {
    const platform = os.platform();
    const arch = os.arch();
    
    return {
        platform,
        arch,
        isWindows: platform === 'win32',
        isLinux: platform === 'linux',
        isArm64: arch === 'arm64',
        isX64: arch === 'x64'
    };
}

function checkTokensInContent(content) {
    const lines = content.split('\n');
    const tokenPattern = /^[A-Z_]+_T\d+\s*=\s*.+/;
    
    return lines.some(line => {
        const trimmed = line.trim();
        if (trimmed.match(tokenPattern)) {
            const value = trimmed.split('=')[1]?.trim();
            return value && value !== '""' && value !== "''";
        }
        return false;
    });
}

async function verifyAndRetryIfNeeded(envPath) {
    try {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const hasToken = checkTokensInContent(envContent);
        
        if (hasToken) {
            console.log(cristal('✅ Variables configuradas'));
            return true;
        } else {
            console.log(instagram('❌ Token NO Configurado'));
            console.log(instagram('¿Quieres abrir el editor nuevamente? (presiona Enter para continuar o Ctrl+C para salir)'));
            
            await new Promise((resolve) => {
                process.stdin.once('data', () => resolve());
            });
            
            return await checkAndEditEnv();
        }
    } catch (error) {
        console.log(instagram('❌ Token NO Configurado', error.message));
        return false;
    }
}

async function checkAndEditEnv() {
    const envPath = path.join(__dirname, '.env');
    const envExamplePath = path.join(__dirname, '.env.example');
    
    let needsEditor = false;
    
    if (!existsSync(envPath)) {
        if (existsSync(envExamplePath)) {
            try {
                const envExampleContent = fs.readFileSync(envExamplePath, 'utf8');
                fs.writeFileSync(envPath, envExampleContent);
                console.log(cristal('📋 Copiado .env.example → .env'));
                needsEditor = true;
            } catch (error) {
                console.log(instagram('❌ Error. Crea manualmente el archivo .env', error.message));
                return false;
            }
        } else {
            console.log(instagram('❌ Error. Crea manualmente el archivo .env'));
            return false;
        }
    }
    
    if (!needsEditor) {
        try {
            const envContent = fs.readFileSync(envPath, 'utf8');
            const hasToken = checkTokensInContent(envContent);
            
            if (hasToken) {
                console.log(cristal('🔧 Variables OK'));
                return true;
            } else {
                console.log(cristal('⚠️ Token NO Configurado'));
                needsEditor = true;
            }
        } catch (error) {
            console.log(instagram('❌ Error leyendo .env:', error.message));
            return false;
        }
    }
    
    if (needsEditor) {
        const systemInfo = getSystemInfo();
        const extrasPath = path.join(__dirname, 'Extras', 'Otros', 'MSEdit');
        
        let editorPath = '';
        
        if (systemInfo.isWindows) {
            editorPath = path.join(extrasPath, 'edit-windows-x86_64.exe');
        } else if (systemInfo.isLinux) {
            if (systemInfo.isArm64) {
                editorPath = path.join(extrasPath, 'edit-linux-aarch64');
            } else if (systemInfo.isX64) {
                editorPath = path.join(extrasPath, 'edit-linux-x86_64');
            } else {
                console.log(instagram('⚠️ Corrige el .env manualmente'));
                return false;
            }
        } else {
            console.log(instagram('⚠️ Corrige el .env manualmente'));
            return false;
        }
        
        if (!existsSync(editorPath)) {
            console.log(instagram('⚠️ Corrige el .env manualmente'));
            return false;
        }
        
        try {
            if (systemInfo.isLinux) {
                await execAsync(`chmod +x "${editorPath}"`);
            }
            
            console.log(cristal('🔧 Configurar .env...'));
            
            if (systemInfo.isWindows) {
                await execAsync(`start /wait "" "${editorPath}" "${envPath}"`);
            } else {
                await new Promise((resolve, reject) => {
                    const editor = spawn(editorPath, [envPath], {
                        stdio: 'inherit',
                        detached: false
                    });
                    
                    editor.on('close', (code) => {
                        resolve();
                    });
                    
                    editor.on('error', (error) => {
                        console.log(instagram('❌ Corrige el .env manualmente', error.message));
                        reject(error);
                    });
                });
            }
            return await verifyAndRetryIfNeeded(envPath);
            
        } catch (error) {
            console.log(instagram('Configura manualmente el archivo .env', error.message));
            return false;
        }
    }
    
    return true;
}

function extractABMetaInfo(content) {
    try {
        const metaMatch = content.match(/ABMetaInfo\s*\(\s*\{([^}]+)\}\s*\)/s);
        if (!metaMatch) return null;
        
        const metaStr = '{' + metaMatch[1] + '}';
        const meta = { url: null, deps: [] };
        
        const urlMatch = metaStr.match(/url\s*:\s*['"`]([^'"`]+)['"`]/);
        if (urlMatch) meta.url = urlMatch[1];
        
        const depsMatch = metaStr.match(/deps\s*:\s*\[([^\]]*)\]/);
        if (depsMatch) {
            meta.deps = depsMatch[1]
                .split(',')
                .map(d => d.trim().replace(/['"`]/g, ''))
                .filter(d => d);
        }
        
        return meta;
    } catch (error) {
        return null;
    }
}

async function updateAdaptersAndPlugins() {
    console.log(cristal('🔄 Actualizando...\n'));
    
    const adaptersPath = path.join(__dirname, 'src', 'adapters');
    const pluginsPath = path.join(__dirname, 'src', 'plugins');
    
    const allDeps = new Set();
    let updatedCount = 0;
    
    for (const basePath of [adaptersPath, pluginsPath]) {
        if (!existsSync(basePath)) continue;
        
        const files = fs.readdirSync(basePath).filter(f => f.endsWith('.js'));
        
        for (const file of files) {
            const filePath = path.join(basePath, file);
            
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const meta = extractABMetaInfo(content);
                
                if (!meta) continue;
                
                if (meta.url) {
                    try {
                        console.log(`  ⬇️  Descargando: ${file}`);
                        const fetch = (await import('node-fetch')).default;
                        const response = await fetch(meta.url);
                        
                        if (!response.ok) {
                            console.log(`  ⚠️  Error descargando ${file}: ${response.statusText}`);
                            continue;
                        }
                        
                        const newContent = await response.text();
                        fs.writeFileSync(filePath, newContent, 'utf8');
                        console.log(`  ✅ Actualizado: ${file}`);
                        updatedCount++;
                    } catch (downloadError) {
                        console.log(`  ⚠️  Error descargando ${file}: ${downloadError.message}`);
                    }
                }
                
                if (meta.deps && meta.deps.length > 0) {
                    meta.deps.forEach(dep => allDeps.add(dep));
                }
                
            } catch (error) {
                console.log(`  ⚠️  Error procesando ${file}: ${error.message}`);
            }
        }
    }
    
    console.log('');
    
    if (updatedCount > 0) {
        console.log(cristal(`✅ ${updatedCount} archivos actualizados`));
    } else {
        console.log(cristal('ℹ️  Sin Actualizaciones'));
    }
    
    if (allDeps.size > 0) {
        const depsArray = Array.from(allDeps);
        console.log(cristal(`📦 Dependencias: ${depsArray.join(', ')}`));
        return depsArray;
    }
    
    return [];
}

async function cleanMediaFolder() {
    const mediaFolder = process.env.MEDIA_FOLDER || path.join(__dirname, 'src', 'media');
    
    if (!existsSync(mediaFolder)) {
        return;
    }
    
    try {
        const files = fs.readdirSync(mediaFolder);
        
        for (const file of files) {
            const filePath = path.join(mediaFolder, file);
            const stat = fs.statSync(filePath);
            
            if (stat.isDirectory()) {
                fs.rmSync(filePath, { recursive: true, force: true });
            } else {
                fs.unlinkSync(filePath);
            }
        }
        
        console.log(cristal('🧹 Carpeta de medios limpiada'));
    } catch (error) {
        console.log(instagram(`⚠️  Error limpiando carpeta de medios: ${error.message}`));
    }
}

async function installDependencies(additionalDeps = []) {
    console.log('🔄 Actualizando\n');

    try {
        await execAsync('git pull', { cwd: __dirname });
    } catch (error) {
        console.error('❌ Error actualizando:', error.message);
    }

    console.log('📦 Instalando dependencias...');
    
    const allDeps = [...additionalDeps].filter((v, i, a) => a.indexOf(v) === i);
    
    const installCmd = allDeps.length > 0 
        ? `npm install ${allDeps.join(' ')} --legacy-peer-deps --force`
        : 'npm install --legacy-peer-deps --force';
    
    try {
        const { stdout, stderr } = await execAsync(installCmd, { cwd: __dirname });
        console.log(cristal('✅ Dependencias instaladas\n'));
        return true;
    } catch (error) {
        console.log(instagram('❌ Error instalando dependencias:', error.message));
        return false;
    }
}

async function startRedis() {
    const redisCommand = process.env.REDIS_COMMAND || 'node Extras/Otros/valkey-server/OS.js';
    
    console.log(cristal('🔴 Iniciando KV...'));
    
    try {
        exec(redisCommand, (error, stdout, stderr) => {
            if (error) {
                console.log(instagram(`⚠️  Error iniciando KV: ${error.message}`));
                return;
            }
            if (stdout) console.log(stdout);
            if (stderr) console.log(stderr);
        });
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        console.log(cristal('✅ KV\n'));
    } catch (error) {
        console.log(instagram(`⚠️  Error en KV: ${error.message}\n`));
    }
}

async function startHandler() {
    try {
        const { default: handler } = await import('./src/core/handler.js');
        await handler(process.env);
    } catch (error) {
        console.log(instagram('❌ Error iniciando', error));
        process.exit(1);
    }
}

async function startPluginHandler() {
    try {
        const { default: PluginHandler } = await import('./src/core/pluginHandler.js');
        const pluginHandler = new PluginHandler(process.env);
        await pluginHandler.initialize();
        
        return pluginHandler;
    } catch (error) {
        console.log(instagram('❌ Error iniciando', error));
        process.exit(1);
    }
}

async function main() {
    try {
        startBanner();

        const envOk = await checkAndEditEnv();
        if (!envOk) {
            process.exit(1);
        }
        
        console.log('');
        
        await cleanMediaFolder();
        
        const dynamicDeps = await updateAdaptersAndPlugins();
        
        await installDependencies(dynamicDeps);
        
        await startRedis();

        process.title = 'AcopleBOT';
        process.stdout.write('\x1b]2;AcopleBOT\x07');

        await Promise.all([
            startHandler(),
            startPluginHandler()
        ]);
        
    } catch (error) {
        console.log(instagram('❌ Error:', error));
        process.exit(1);
    }
}

process.on('SIGINT', async () => {
    console.log(instagram('\n🛑 Solicitud de Cierre Recibida, Cerrando...'));
    
    if (global.pluginHandler) {
        await global.pluginHandler.shutdown();
    }
    
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log(instagram('\n🛑 Solicitud de Cierre Recibida, Cerrando...'));
    
    if (global.pluginHandler) {
        await global.pluginHandler.shutdown();
    }
    
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.log(instagram('💥', error));
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log(instagram('💥', promise, reason));
    process.exit(1);
});

main();
