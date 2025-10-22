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

function checkRegla1InContent(content) {
    return content.split('\n').some(line => {
        const trimmedLine = line.trim();
        if (trimmedLine.match(/^REGLA_1\s*=\s*.+/)) {
            const value = trimmedLine.split('=')[1]?.trim();
            return value && value !== '""' && value !== "''";
        }
        return false;
    });
}

async function verifyAndRetryIfNeeded(envPath) {
    try {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const hasRegla1 = checkRegla1InContent(envContent);
        
        if (hasRegla1) {
            console.log(cristal('✅ Variables configuradas correctamente'));
            return true;
        } else {
            console.log(instagram('❌ REGLA_1 aún no está configurada'));
            console.log(instagram('¿Quieres abrir el editor nuevamente? (presiona Enter para continuar o Ctrl+C para salir)'));
            
            await new Promise((resolve) => {
                process.stdin.once('data', () => resolve());
            });
            
            return await checkAndEditEnv();
        }
    } catch (error) {
        console.log(instagram('❌ Error verificando configuración:', error.message));
        return false;
    }
}

async function checkAndEditEnv() {
    const envPath = path.join(__dirname, '.env');
    const envExamplePath = path.join(__dirname, '.env.example');
    
    if (!existsSync(envPath)) {
        if (existsSync(envExamplePath)) {
            try {
                const envExampleContent = fs.readFileSync(envExamplePath, 'utf8');
                fs.writeFileSync(envPath, envExampleContent);
                console.log(cristal('📋 Copiado .env.example → .env'));
            } catch (error) {
                console.log(instagram('❌ Error copiando .env.example:', error.message));
                console.log(instagram('Crea manualmente el archivo .env'));
                return false;
            }
        } else {
            console.log(instagram('❌ No se encontró .env.example'));
            console.log(instagram('Crea manualmente el archivo .env'));
            return false;
        }
    }
    
    try {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const hasRegla1 = checkRegla1InContent(envContent);
        
        if (hasRegla1) {
            console.log(cristal('🔧 Variables OK'));
            return true;
        } else {
            console.log(cristal('⚠️ Falta configurar REGLA_1'));
        }
    } catch (error) {
        console.log(instagram('❌ Error leyendo .env:', error.message));
    }
    
    const systemInfo = getSystemInfo();
    const extrasPath = path.join(__dirname, 'Extras', 'Otros', 'Binarios', 'MSEdit');
    
    let editorPath = '';
    
    if (systemInfo.isWindows) {
        editorPath = path.join(extrasPath, 'edit-windows-x86_64.exe');
    } else if (systemInfo.isLinux) {
        if (systemInfo.isArm64) {
            editorPath = path.join(extrasPath, 'edit-linux-aarch64');
        } else if (systemInfo.isX64) {
            editorPath = path.join(extrasPath, 'edit-linux-x86_64');
        } else {
            console.log(instagram('Corrige el .env manualmente'));
            return false;
        }
    } else {
        console.log(instagram('Corrige el .env manualmente'));
        return false;
    }
    
    if (!existsSync(editorPath)) {
        console.log(instagram('Editor no encontrado. Corrige el .env manualmente'));
        return false;
    }
    
    try {
        if (systemInfo.isLinux) {
            await execAsync(`chmod +x "${editorPath}"`);
        }
        
        console.log(cristal('🔧 Abriendo editor para configurar .env...'));
        
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
                    console.log(instagram('❌ Error abriendo editor:', error.message));
                    reject(error);
                });
            });
        }
        return await verifyAndRetryIfNeeded(envPath);
        
    } catch (error) {
        console.log(instagram('❌ Error ejecutando editor:', error.message));
        console.log(instagram('Configura manualmente el archivo .env'));
        return false;
    }
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
    console.log(cristal('🔄 Actualizando adaptadores y plugins...\n'));
    
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
        console.log(cristal(`✅ ${updatedCount} archivo(s) actualizado(s)`));
    } else {
        console.log(cristal('ℹ️  No hay actualizaciones disponibles'));
    }
    
    if (allDeps.size > 0) {
        const depsArray = Array.from(allDeps);
        console.log(cristal(`📦 Dependencias detectadas: ${depsArray.join(', ')}`));
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
    console.log('📡 Actualizando repositorio...\n');

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

async function startHandler() {
    try {
        const { default: handler } = await import('./src/core/handler.js');
        await handler(process.env);
    } catch (error) {
        console.log(instagram('❌ Error iniciando Adapter Handler:', error));
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
        console.log(instagram('❌ Error iniciando Plugin Handler:', error));
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
    console.log(instagram('\n🛑 SIGINT Recibido, Cerrando...'));
    
    if (global.pluginHandler) {
        await global.pluginHandler.shutdown();
    }
    
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log(instagram('\n🛑 SIGTERM Recibido, Cerrando...'));
    
    if (global.pluginHandler) {
        await global.pluginHandler.shutdown();
    }
    
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.log(instagram('💥 Solicitud Desconocida, Cerrando:', error));
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log(instagram('💥 Promise:', promise));
    console.log(instagram('Razón:', reason));
    process.exit(1);
});

main();