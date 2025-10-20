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
    const envExamplePath = path.join(__dirname, 'Extras', 'Otros', '.env.example');
    
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

async function installDependencies() {
    
    console.log('📡 Actualizando...\n');
    
    try {
        const { stdout, stderr } = await execAsync('git pull', { cwd: __dirname });
        if (stdout) console.log(stdout);
        if (stderr && !stderr.includes('Already up to date')) console.log(stderr);
    } catch (error) {
        console.error('❌', error.message);
    }

    console.log('📦 Instalando...');
    try {
        const { stdout, stderr } = await execAsync('npm install', { cwd: __dirname });
        
        console.log(cristal('✅ Dependencias Instaladas \n'));
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
        console.log(instagram('❌Error iniciando:', error));
        
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
        await installDependencies();

        process.title = 'AcopleBOT';
        process.stdout.write('\x1b]2;AcopleBOT\x07');

        await startHandler();
        
    } catch (error) {
        console.log(instagram('❌Error:', error));
        process.exit(1);
    }
}

process.on('SIGINT', () => {
    console.log(instagram('\n🛑SIGINT Recibido, Cerrando...'));
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log(instagram('\n🛑SIGTERM Recibido, Cerrando...'));
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.log(instagram('💥Solicitud Desconocida, Cerrando:', error));
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log(instagram('💥Promise:', promise));
    console.log(instagram('Razón:', reason));
    process.exit(1);
});

main();