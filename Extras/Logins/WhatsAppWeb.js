// Para WhatsApp Web.JS. Falta Adaptador.
// https://github.com/pedroslopez/whatsapp-web.js/


import pkg from 'whatsapp-web.js';
const {Client, LocalAuth} = pkg;
import qrcode from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import {fileURLToPath} from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sessionPath = path.join(__dirname, '..', 'DatosPlugins', 'WhatsApp WebJS', 'session-1');

if (!fs.existsSync(sessionPath)) {
  fs.mkdirSync(sessionPath, {recursive: true});
}

const puppeteerOpts = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu'
  ]
};

const chromiumPath = process.env.CHROMIUM || '/data/data/com.termux/files/usr/bin/chromium-browser';

if (fs.existsSync(chromiumPath)) {
  puppeteerOpts.executablePath = chromiumPath;
  console.log(`✅ U ${chromiumPath}\n`);
} else {
  console.error(`❌ Chromium no encontrado en: ${chromiumPath}`);
  console.error('Instala con: pkg install chromium');
  console.error('O define CHROMIUM=/ruta/a/chromium en .env\n');
  process.exit(1);
}

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'session-1',
    dataPath: sessionPath
  }),
  puppeteer: puppeteerOpts
});

client.on('qr', (qr) => {
  console.log('\n📱 Escanea este QR con WhatsApp:\n');
  qrcode.generate(qr, {small: true});
  console.log('\n');
});

client.on('authenticated', () => {
  console.log('✅ Autenticado ');
});

client.on('auth_failure', (msg) => {
  console.error('❌  fallidao', msg);
  process.exit(1);
});

client.on('ready', () => {
  const info = client.info;
  console.log(`\n✅ Conectado como: ${info.pushname}`);
  console.log(`📞 ${info.wid.user}`);
  console.log(`\n🔐 Sesión guardada en: ${sessionPath}`);
  console.log('\n✅ Puedes cerrar .\n');
  
  setTimeout(async () => {
    await client.destroy();
    process.exit(0);
  }, 3000);
});

console.log('🔄 Iniciando WhatsApp Web...\n');
client.initialize();