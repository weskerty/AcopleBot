import { parentPort } from 'worker_threads';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ABMetaInfo = () => {};

ABMetaInfo({
    pattern: 'dado ?(.*)',
    url: '',
    sudo: false,
    desc: 'Envía un dado aleatorio como sticker',
    type: 'game',
    deps: ['node-fetch']
});

const DICE_URLS = [
    'https://tinyurl.com/gdd01',
    'https://tinyurl.com/gdd02',
    'https://tinyurl.com/gdd003',
    'https://tinyurl.com/gdd004',
    'https://tinyurl.com/gdd05',
    'https://tinyurl.com/gdd006'
];

const MEDIA_FOLDER = process.env.MEDIA_FOLDER 
    ? (process.env.MEDIA_FOLDER.startsWith('/') 
        ? process.env.MEDIA_FOLDER 
        : path.join(process.cwd(), process.env.MEDIA_FOLDER))
    : path.join(process.cwd(), 'src', 'media');

const downloadDice = async () => {
    const url = DICE_URLS[Math.floor(Math.random() * DICE_URLS.length)];
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    return Buffer.from(buf);
};

const saveTempFile = async (buffer) => {
    if (!fs.existsSync(MEDIA_FOLDER)) {
        fs.mkdirSync(MEDIA_FOLDER, { recursive: true });
    }
    
    const filename = `dado_${Date.now()}_${crypto.randomUUID().substring(0, 8)}.webp`;
    const filePath = path.join(MEDIA_FOLDER, filename);
    
    await fs.promises.writeFile(filePath, buffer);
    
    return filePath;
};

parentPort.on('message', async (data) => {
    try {
        const { message } = data;
        
        parentPort.postMessage({
            type: 'log',
            message: `Lanzando dado para usuario ${message.author.displayName}`
        });
        
        const buffer = await downloadDice();
        const filePath = await saveTempFile(buffer);
        
        parentPort.postMessage({
            type: 'response',
            originalMessage: message,
            response: {
                text: '🎲',
                attachments: [{
                    type: 'sticker',
                    fileUrl: null,
                    filePath: filePath,
                    filename: path.basename(filePath),
                    mimeType: 'image/webp',
                    size: buffer.length,
                    width: 512,
                    height: 512,
                    duration: null,
                    caption: null
                }]
            }
        });
        
    } catch (error) {
        parentPort.postMessage({
            type: 'error',
            message: `Error: ${error.message}`
        });
        
        parentPort.postMessage({
            type: 'response',
            originalMessage: data.message,
            response: {
                text: `❌ Error: ${error.message}`
            }
        });
    }
});
