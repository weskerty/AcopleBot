import { parentPort } from 'worker_threads';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const E0 = promisify(execFile);
const F0 = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const G0 = path.join(__dirname, 'Extras', 'DatosPlugins', 'SysInfo');

const ABMetaInfo = () => {};
ABMetaInfo({ pattern: 'sysinfo ?(.*)', url: '', sudo: true, desc: 'Información del Servidor', type: 'machine', deps: [] });

const B1 = (m) => { parentPort.postMessage({ type: 'log', message: m }) };
const C1 = (oM, t, i) => { parentPort.postMessage({ type: 'response', originalMessage: oM, response: { text: t, attachments: i ? [{ type: 'image', filePath: i, mime: 'image/png' }] : null } }) };
const D1 = (oM, t) => { parentPort.postMessage({ type: 'response', originalMessage: oM, response: { text: t, attachments: null } }) };

const H1 = {
    B: path.join(G0, 'bin'),
    T: new Map([
        ['linux-x64', { url: 'https://github.com/fastfetch-cli/fastfetch/releases/download/2.35.0/fastfetch-linux-amd64.tar.gz', p: 'fastfetch-linux-amd64/usr/bin/fastfetch' }],
        ['linux-arm64', { url: 'https://github.com/fastfetch-cli/fastfetch/releases/download/2.35.0/fastfetch-linux-aarch64.tar.gz', p: 'fastfetch-linux-aarch64/usr/bin/fastfetch' }],
        ['win32-x64', { url: 'https://github.com/fastfetch-cli/fastfetch/releases/download/2.35.0/fastfetch-windows-amd64.zip', p: 'fastfetch-windows-amd64/fastfetch.exe' }],
    ]),
};

function I1() {
    let p = os.platform(), a = os.arch();
    if (p === 'android') p = 'linux';
    if (p === 'linux') a = (a === 'arm64' || a === 'aarch64') ? 'arm64' : 'x64';
    if (p === 'win32') a = 'x64';
    return { p, a };
}

async function J1(c, f = null) {
    try {
        const { stdout: s } = await F0(c);
        return s.trim();
    } catch (e) {
        if (f) {
            try {
                const { stdout: s } = await F0(f);
                return s.trim();
            } catch (err) { return null; }
        }
        return null;
    }
}

async function K1() {
    const { p: P } = I1();
    try {
        if (P === 'linux') {
            try {
                await F0('pkg update -y && pkg install fastfetch -y');
                return true;
            } catch {}
            await F0('sudo apt update && sudo apt install fastfetch -y');
            return true;
        }
    } catch (e) {
        B1(`Instalación fallida: ${e.message}`);
        return false;
    }
    return false;
}

async function L1() {
    const { p: P, a: A } = I1();
    const K = `${P}-${A}`;
    const B = H1.T.get(K);
    if (!B) throw new Error(`Sistema no soportado: ${K}`);

    await fs.mkdir(H1.B, { recursive: true });
    const D = path.join(H1.B, path.basename(B.url));
    const E = H1.B;

    try {
        await F0(`curl -fsSL -o "${D}" "${B.url}"`);
        if (P === 'win32') {
            await F0(`powershell -Command "Expand-Archive -Path '${D}' -DestinationPath '${E}' -Force"`);
        } else {
            await F0(`tar xf "${D}" -C "${E}"`);
        }
        const L = path.join(H1.B, B.p);
        if (P !== 'win32') await fs.chmod(L, '755');
        await fs.unlink(D);
        return L;
    } catch (e) {
        B1(`Error en descarga/extracción: ${e}`);
        throw e;
    }
}

async function M1() {
    try {
        const w = await J1('which fastfetch');
        if (w) return 'fastfetch';
    } catch {}

    if (await K1()) return 'fastfetch';

    const { p: P, a: A } = I1();
    const K = `${P}-${A}`;
    const B = H1.T.get(K);
    const L = path.join(H1.B, B.p);

    try {
        await fs.access(L);
        return L;
    } catch {
        return await L1();
    }
}

async function N1() {
    const V = [];
    const C = [
        { n: 'Node.js', c: 'node -v', e: '🟢' },
        { n: 'NPM', c: 'npm -v', e: '📦' },
        { n: 'Python', c: 'python3 --version', f: 'python --version', e: '🐍' },
        { n: 'Chocolatey', c: 'choco --version', e: '🍫' },
        { n: 'FFmpeg', c: 'ffmpeg -version', e: '🎬', p: (o) => o.split('\n')[0] }
    ];

    V.push(`*Sudo* ${await J1('which sudo') ? '✅' : '✖'}`);

    const O = await J1('pip3 --version', 'pip --version');
    let P = '✖';
    if (O) {
        const M = O.match(/pip\s+(\d+\.\d+\.\d+)/);
        P = M ? M[1] : O;
    }
    V.push(`📊 *PIP:* ${P}`);

    for (const c of C) {
        const O = await J1(c.c, c.f);
        let v = O ? (c.p ? c.p(O) : O) : '✖';
        V.push(`${c.e} *${c.n}:* ${v}`);
    }
    return V.join('\n');
}

async function O1(m) {
    const S = path.join(G0, 'ookla-speedtest.py');

    try {
        await fs.mkdir(G0, { recursive: true });

        try {
            await fs.access(S);
        } catch {
            const U = 'https://raw.githubusercontent.com/weskerty/MysticTools/refs/heads/main/Utilidades/ookla-speedtest.py';
            await F0(`curl -fsSL -o "${S}" "${U}"`);
            await F0(`chmod +x ${S}`);
        }

        const O = await J1(`python3 ${S} --secure --share`, `python ${S} --secure --share`);
        if (!O) throw new Error('Falló la ejecución del speedtest');

        const M = O.match(/http[^"]+\.png/);
        if (M) {
            const U = M[0];
            const fetch = (await import('node-fetch')).default;
            const R = await fetch(U);
            const I = path.join(__dirname, '..', `speedtest_${Date.now()}.png`);
            await fs.writeFile(I, Buffer.from(await R.arrayBuffer()));

            C1(m, O, I);
            await fs.unlink(I).catch(() => {});
        } else {
            D1(m, O);
        }
        return O;
    } catch (e) {
        B1(`Error en Speedtest: ${e.message}`);
        D1(m, '❌ Error');
        return null;
    }
}

async function P1(m) {
    try {
        const F = await M1();
        const S = await J1(`"${F}" -l none -c all`);

        if (S) D1(m, S);
        else throw new Error('Fallo fastfetch');

        const V = await N1();
        D1(m, V);

        await O1(m);
    } catch (e) {
        B1(`Error en SYSINFO: ${e}`);
        D1(m, `❌ Error en SYSINFO: ${e.message}`);
    }
}

parentPort.on('message', async (d) => { await P1(d.message); });
