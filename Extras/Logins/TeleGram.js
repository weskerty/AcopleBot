// Solo para GramJS. No se mantiene hace mucho. Pensando en la idea de usar un script Python para que Handler lo inicie de manera autonoma.


import {TelegramClient} from 'telegram';
import {StringSession} from 'telegram/sessions/index.js';
import input from 'input';
import path from 'path';
import fs from 'fs';
import {fileURLToPath} from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TG_API_ID = process.env.TGAPID;
const TG_API_HASH = process.env.TGAPIH;

console.log('🔹 TG_API_ID =', TG_API_ID);
console.log('🔹 TG_API_HASH =', TG_API_HASH);

if (!TG_API_ID || !TG_API_HASH) {
  console.error('❌ TGAPID y TGAPIH requeridos en .env');
  process.exit(1);
}

const sessionPath = path.join(__dirname, '..', 'DatosPlugins', 'GramJS', 'tg1.session');
if (!fs.existsSync(path.dirname(sessionPath))) fs.mkdirSync(path.dirname(sessionPath), {recursive: true});

let sessionString = '';
if (fs.existsSync(sessionPath)) {
  sessionString = fs.readFileSync(sessionPath, 'utf8').trim();
  console.log('📂 Sesión existente encontrada');
}

const client = new TelegramClient(
  new StringSession(sessionString),
  parseInt(TG_API_ID),
  TG_API_HASH,
  {connectionRetries: 5}
);

(async () => {
  try {
    await client.start({
      phoneNumber: async () => await input.text('Número de teléfono con código país):'),
      phoneCode: async () => await input.text('Código SMS:'),
      password: async () => await input.text('Contraseña:'),
      onError: (err) => console.log('❌ Error start:', err),
    });

    const me = await client.getMe();
    console.log('\n✅ Autenticacdo');
    console.log(`👤  ${me.firstName} ${me.lastName || ''}`);
    console.log(`📞  ${me.phone}`);
    console.log(`🆔 ${me.id}`);

    fs.writeFileSync(sessionPath, client.session.save(), 'utf8');
    console.log(`\n🔐 guardada en: ${sessionPath}`);

    await client.disconnect();
  } catch (error) {
    console.error('\n❌ Error:', error);
    await client.disconnect();
    process.exit(1);
  }
})();