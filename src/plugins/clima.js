import { parentPort } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';

// Debe ser 'ABMetaInfo' para que el Handler lo detecte
const ABMetaInfo = () => {};
ABMetaInfo({ pattern: 'temp ?(.*)', url: '', sudo: false, desc: 'Clima de Ciudad', type: 'utilidad', deps: [''] });

const B1 = (m) => { parentPort.postMessage({ type: 'log', message: m }) };
const C1 = (oM, t) => { parentPort.postMessage({ type: 'response', originalMessage: oM, response: { text: t, attachments: null } }) };
const D1 = (v) => Math.floor(v);

async function E1(m, c) {
    if (!c) return C1(m, '*Uso: .temp <ciudad>*');

    const F1 = `http://api.openweathermap.org/data/2.5/weather?q=${c}&units=metric&appid=060a6bcfa19809c2cd4d97a212b19273&lang=es`;
    let G1;

    try {
        const fetch = (await import('node-fetch')).default;
        const r = await fetch(F1);
        if (!r.ok) throw new Error('API Error');
        G1 = await r.json();
    } catch (e) {
        return C1(m, `_Ciudad ${c} no encontrada_`);
    }

    const { name: H1, timezone: I1, sys: J1, main: K1, weather: L1, visibility: M1, wind: N1 } = G1;
    const O1 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][D1(N1.deg / 22.5 + 0.5) % 16];

    // Lógica de formateo de tiempo (sin momentjs)
    const Q1 = (t, z) => {
        const d = new Date((t + z) * 1000);
        let h = d.getUTCHours();
        const m = d.getUTCMinutes();
        const p = h >= 12 ? 'pm' : 'am';
        h = h % 12;
        h = h ? h : 12;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${p}`;
    };

    const R1 = `*Ciudad:* ${H1}\n*País:* ${J1.country}\n*Clima:* ${L1[0].description}\n*Temp :* ${D1(K1.temp)}°C\n*Sensación:* ${D1(K1.feels_like)}°C\n*Humedad :* ${K1.humidity}%\n*Visibilidad  :* ${M1}m\n*Viento* : ${N1.speed}m/s ${O1}\n*Amanecer :* ${Q1(J1.sunrise, I1)}\n*Anochecer :* ${Q1(J1.sunset, I1)}`;

    C1(m, R1);
}

parentPort.on('message', async (d) => { E1(d.message, d.args) });
