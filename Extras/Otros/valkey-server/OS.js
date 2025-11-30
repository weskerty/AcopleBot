import 'dotenv/config';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const P = process.env.VALKEY_PORT || '6379';
const M = process.env.VALKEY_MAXMEMORY || '100mb';

const ARGS_ARRAY = ['--port', P, '--maxmemory', M]; //
const CMDS = ['valkey-server', 'redis-server', 'keydb-server'];


function startServer(command, args) {
    console.log(`🔌Iniciando: ${command} ${args.join(' ')}`);
    const serverProcess = spawn(command, args, {
        stdio: 'inherit',
        shell: false
    });

    serverProcess.on('error', (err) => {
        console.error(`❌ Error al iniciar ${command}:`, err.message);
        process.exit(1);
    });

    serverProcess.on('exit', (code) => {
        if (code !== 0 && code !== null) {
            console.error(`❌ ${command} ${code}`);
        } else {
            console.log(` ${command} cerrado.`);
        }
        process.exit(code || 0);
    });
}
async function trySystemBinary() {
    for (const cmd of CMDS) {
        try {
            await execAsync(`${cmd} --version`);
            console.log(`🔎 Sistema: ${cmd}`);
            startServer(cmd, ARGS_ARRAY);
            return true;
        } catch {}
    }
    return false;
}

function getBinaryPath() {
    const platform = os.platform();
    const arch = os.arch();

    const mappings = {
        'linux-x64': 'linux-x64',
        'linux-arm64': 'linux-arm64',
        'darwin-x64': 'darwin-x64',
        'darwin-arm64': 'darwin-arm64',
        'win32-x64': 'windows-x64.exe'
    };

    const key = `${platform}-${arch}`;
    const binName = mappings[key];

    if (!binName) {
        console.log(` Sistema no soportado: ${key}`);
        return null;
    }

    const binPath = path.join(__dirname, binName);

    if (fs.existsSync(binPath)) {
        return binPath;
    }

    console.log(` Binario no encontrado: ${binPath}`);
    return null;
}

async function main() {
    const systemBinaryStarted = await trySystemBinary();
    if (systemBinaryStarted) {
        return;
    }
    const bin = getBinaryPath();

    if (!bin) {
        console.error('❌ Sin KVServer para tu sistema. Deberas instalar Valkey Manualmente.');
        console.error(`Sistema: ${os.platform()}-${os.arch()}`);
        process.exit(1);
    }

    try {
        fs.chmodSync(bin, '755');
    } catch (e) {
    }
    startServer(bin, ARGS_ARRAY);
}

main();
