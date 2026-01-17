import { parentPort } from 'worker_threads';
import crypto from 'crypto';
import FormData from 'form-data';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const E0 = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const F0 = path.join(__dirname, '..', 'media');

const ABMetaInfo = () => {};
ABMetaInfo({ pattern: 'find', url: '', sudo: false, desc: 'Identifica una canción por audio/video citado (Recorte FFmpeg)', type: 'search', deps: ['node-fetch', 'form-data'] });

const B1 = (m) => { parentPort.postMessage({ type: 'log', message: m }) };
const C1 = (oM, t) => { parentPort.postMessage({ type: 'response', originalMessage: oM, response: { text: t, attachments: null } }) };

const D1 = {
    host: 'identify-eu-west-1.acrcloud.com',
    endpoint: '/v1/identify',
    signature_version: '1',
    data_type: 'audio',
    secure: true,
    access_key: 'c816ad50a2bd6282e07b90447d93c38c',
    access_secret: 'ZpYSwmCFpRovcSQBCFCe1KArX7xt8DTkYx2XKiIP',
};

const E1 = (m, u, aK, d, sV, t) => [m, u, aK, d, sV, t].join('\n');
const G1 = (sS, aS) => crypto.createHmac('sha1', aS).update(Buffer.from(sS, 'utf-8')).digest().toString('base64');

async function I1(iP) {
    const S2 = `acr_${Date.now()}.mp3`;
    const O2 = path.join(F0, S2);
    const A2 = ['-i', iP, '-ss', '0', '-to', '15', '-y', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', '128k', O2];

    try {
        await fs.mkdir(F0, { recursive: true });
        B1('Recortando audio con FFmpeg...');
        await E0('ffmpeg', A2, { timeout: 30000 });
        return O2;
    } catch (e) {
        B1(`Error en FFmpeg: ${e.message}`);
        throw new Error('Falló el procesamiento');
    }
}

async function H1(m, a, fC) {
    let J1 = null;


    if (fC.message?.replyTo?.attachments?.length > 0) {
        const rA = fC.message.replyTo.attachments[0];
        if (rA.filePath) {
            J1 = rA.filePath;
        }
    }

    if (!J1) return C1(m, '*Responde a un mensaje que contenga un archivo de audio o video.*');

    try {
        // Verifica si el archivo existe
        await fs.access(J1, fs.constants.F_OK);
    } catch (e) {
        return C1(m, `❌Media Faltante: ${J1}`);
    }

    let K2, T2;
    try {
        T2 = await I1(J1);
        K2 = await fs.readFile(T2);
    } catch(e) {
        return C1(m, e.message.includes('Falló') ? `❌ ${e.message}` : '*Error al procesar el archivo citado.*');
    } finally {
        if (T2) await fs.rm(T2, { force: true }); // Limpiar archivo temporal
    }

    const L1 = Date.now() / 1000;
    const M1 = E1('POST', D1.endpoint, D1.access_key, D1.data_type, D1.signature_version, L1);
    const N1 = G1(M1, D1.access_secret);
    const O1 = new FormData();

    O1.append('sample', K2);
    O1.append('sample_bytes', K2.length);
    O1.append('access_key', D1.access_key);
    O1.append('data_type', D1.data_type);
    O1.append('signature_version', D1.signature_version);
    O1.append('signature', N1);
    O1.append('timestamp', L1);

    const fetch = (await import('node-fetch')).default;
    const P1 = `https://${D1.host}${D1.endpoint}`;

    const Q1 = await fetch(P1, { method: 'POST', body: O1 });
    const { status: R1, metadata: S1 } = await Q1.json();

    if (R1.code !== 0) return C1(m, `❌ ${R1.msg}`);

    if (!S1.music || S1.music.length === 0) return C1(m, '❌ No se encontró.');

    const { album: T1, release_date: U1, artists: V1, title: W1 } = S1.music[0];

    const X1 = `✅ *Canción Encontrada*\n*Título:* ${W1}\n*Álbum:* ${T1?.name || 'Desconocido'}\n*Artistas:* ${V1 ? V1.map(v => v.name).join(', ') : 'Desconocido'}\n*Lanzamiento:* ${U1 || 'Desconocido'}`;

    C1(m, X1);
}

parentPort.on('message', async (d) => { await H1(d.message, d.args, d.fullContext); });
