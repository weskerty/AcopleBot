import { parentPort } from 'worker_threads';
import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';

const ABMetaInfo = () => {};

ABMetaInfo({
    pattern: 'gq ?(.*)',
    url: '',
    sudo: false,
    desc: 'Transcribe audio, analiza imágenes y responde texto con Groq AI',
    type: 'AI',
    deps: ['node-fetch', 'form-data']
});

const CFG = {
    K: process.env.GROQ_API_KEY,
    M: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    S: process.env.GROQ_SYSTEM_MSG || 'Eres un asistente útil.',
    I: process.env.GROQ_IMAGE_MODEL || 'llama-3.2-90b-vision-preview',
    A: process.env.GROQ_AUDIO_MODEL || 'whisper-large-v3'
};

const apiCall = async (url, method, headers, body, retries = 3) => {
    const h = { ...headers, Authorization: `Bearer ${CFG.K}` };
    for (let i = 1; i <= retries; i++) {
        try {
            const res = await fetch(url, { method, headers: h, body });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`API Error: ${res.status} - ${txt}`);
            }
            return await res.json();
        } catch (err) {
            if (i === retries) throw err;
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
        }
    }
};

const API = {
    async transcribeAudio(buf) {
        const fd = new FormData();
        fd.append('model', CFG.A);
        fd.append('file', buf, { filename: 'audio.ogg', contentType: 'audio/ogg' });
        const res = await apiCall('https://api.groq.com/openai/v1/audio/transcriptions', 'POST', fd.getHeaders(), fd);
        return res.text?.trim() || 'No transcription available';
    },
    
    async analyzeImage(buf, prompt) {
        const b64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
        const body = {
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt || 'Describe esta imagen' },
                    { type: 'image_url', image_url: { url: b64 } }
                ]
            }],
            model: CFG.I,
            temperature: 1,
            max_tokens: 1024,
            top_p: 1,
            stream: false,
            stop: null
        };
        const res = await apiCall('https://api.groq.com/openai/v1/chat/completions', 'POST', { 'Content-Type': 'application/json' }, JSON.stringify(body));
        return res.choices[0].message.content.trim();
    },
    
    async chatCompletion(userMsg, quotedText = null) {
        const body = {
            messages: [{ role: 'system', content: CFG.S }],
            model: CFG.M,
            temperature: 1,
            max_tokens: 2024,
            top_p: 1,
            stream: false,
            stop: null
        };
        if (quotedText) {
            body.messages.push(
                { role: 'system', content: userMsg },
                { role: 'user', content: quotedText.substring(0, 2000) }
            );
        } else {
            body.messages.push({ role: 'user', content: userMsg.substring(0, 2000) });
        }
        const res = await apiCall('https://api.groq.com/openai/v1/chat/completions', 'POST', { 'Content-Type': 'application/json' }, JSON.stringify(body));
        return res.choices[0].message.content.trim();
    }
};

parentPort.on('message', async (data) => {
    try {
        const { message, args, fullContext } = data;
        
        if (!CFG.K) {
            return parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: { text: '❌ Configura GROQ_API_KEY con .setvar\nKey en: https://console.groq.com/keys' }
            });
        }
        
        parentPort.postMessage({
            type: 'log',
            message: `Procesando gq para usuario ${message.author.displayName}`
        });
        
        const userPrompt = args.replace(/^gq\s*/i, '').trim();
        let quotedText = null;
        let audioAttachment = null;
        let imageAttachment = null;
        
        if (fullContext.message?.replyTo) {
            const reply = fullContext.message.replyTo;
            
            if (reply.message?.text && !reply.message.text.startsWith('[')) {
                quotedText = reply.message.text;
            }
            
            if (reply.attachments && reply.attachments.length > 0) {
                const att = reply.attachments[0];
                if (att.type === 'audio' || att.type === 'voice') {
                    audioAttachment = att;
                }
                if (att.type === 'image' || att.type?.startsWith('image')) {
                    imageAttachment = att;
                }
            }
        }
        
        if (!imageAttachment && !audioAttachment && fullContext.attachments && fullContext.attachments.length > 0) {
            const att = fullContext.attachments[0];
            if (att.type === 'audio' || att.type === 'voice') {
                audioAttachment = att;
            }
            if (att.type === 'image' || att.type?.startsWith('image')) {
                imageAttachment = att;
            }
        }
        
        if (audioAttachment) {
            parentPort.postMessage({
                type: 'log',
                message: `Audio detectado: ${JSON.stringify(audioAttachment)}`
            });
            
            if (!audioAttachment.filePath) {
                return parentPort.postMessage({
                    type: 'response',
                    originalMessage: message,
                    response: { text: '❌ Audio sin filePath' }
                });
            }
            
            if (!fs.existsSync(audioAttachment.filePath)) {
                return parentPort.postMessage({
                    type: 'response',
                    originalMessage: message,
                    response: { text: `❌ Archivo no existe: ${audioAttachment.filePath}` }
                });
            }
            
            const buf = await fs.promises.readFile(audioAttachment.filePath);
            const transcription = await API.transcribeAudio(buf);
            
            if (userPrompt) {
                const combined = `${userPrompt}\n\nTexto citado: ${transcription}`;
                const result = await API.chatCompletion(combined);
                return parentPort.postMessage({
                    type: 'response',
                    originalMessage: message,
                    response: { text: result }
                });
            }
            
            return parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: { text: transcription }
            });
        }
        
        if (imageAttachment) {
            parentPort.postMessage({
                type: 'log',
                message: `Imagen detectada: ${JSON.stringify(imageAttachment)}`
            });
            
            if (!imageAttachment.filePath) {
                return parentPort.postMessage({
                    type: 'response',
                    originalMessage: message,
                    response: { text: '❌ Imagen sin filePath' }
                });
            }
            
            if (!fs.existsSync(imageAttachment.filePath)) {
                return parentPort.postMessage({
                    type: 'response',
                    originalMessage: message,
                    response: { text: `❌ Archivo no existe: ${imageAttachment.filePath}` }
                });
            }
            
            const buf = await fs.promises.readFile(imageAttachment.filePath);
            const analysis = await API.analyzeImage(buf, userPrompt || 'Describe esta imagen');
            
            return parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: { text: analysis }
            });
        }
        
        if (userPrompt && quotedText) {
            const result = await API.chatCompletion(userPrompt, quotedText);
            return parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: { text: result }
            });
        }
        
        if (userPrompt) {
            const result = await API.chatCompletion(userPrompt);
            return parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: { text: result }
            });
        }
        
        if (quotedText) {
            const result = await API.chatCompletion(quotedText);
            return parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: { text: result }
            });
        }
        
        parentPort.postMessage({
            type: 'response',
            originalMessage: message,
            response: {
                text: '> Ejemplos:\n- gq ¿Cuál es la capital de Francia?\n- gq ¿Qué hay en esta imagen? (responde a una imagen)\n- gq Analiza este texto (responde a un mensaje)'
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
            response: { text: `❌ ${error.message}` }
        });
    }
});
