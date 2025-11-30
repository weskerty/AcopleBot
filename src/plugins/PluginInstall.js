import { parentPort } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const ABMetaInfo = () => {};

ABMetaInfo({
    pattern: 'plg ?(.*)',
    url: '',
    sudo: true,
    desc: 'Instalador de plugins desde URL y eliminación por nombre',
    type: 'utilidad',
    deps: ['']
});

const PLUGINS_PATH = path.join(process.cwd(), 'src', 'plugins');

const isValidUrl = (str) => {
    try {
        new URL(str);
        return true;
    } catch {
        return false;
    }
};

const extractPattern = (content) => {
    try {
        const match = /ABMetaInfo\s*\(\s*\{([^}]+)\}\s*\)/s.exec(content);
        if (!match) return null;
        
        const metaStr = '{' + match[1] + '}';
        const patternMatch = /pattern\s*:\s*['"`]([^'"`]+)['"`]/.exec(metaStr);
        
        return patternMatch ? patternMatch[1] : null;
    } catch {
        return null;
    }
};

const sanitizeFilename = (pattern) => {
    return pattern
        .replace(/\s*\?\(\.\*\)\s*$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
};

const downloadPlugin = async (url) => {
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Error al descargar: ${response.statusText}`);
        }
        
        const content = await response.text();
        const pattern = extractPattern(content);
        
        if (!pattern) {
            throw new Error('Plugin incompatible: no tiene pattern en ABMetaInfo');
        }
        
        const filename = sanitizeFilename(pattern) + '.js';
        const filePath = path.join(PLUGINS_PATH, filename);
        
        await fs.promises.writeFile(filePath, content, 'utf8');
        
        return filename;
        
    } catch (error) {
        throw new Error(`Error al descargar el plugin: ${error.message}`);
    }
};

const deletePlugin = async (name) => {
    const filename = name.endsWith('.js') ? name : name + '.js';
    const filePath = path.join(PLUGINS_PATH, filename);
    
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return `✅ 🗑️ ${filename} eliminado`;
        } else {
            return `❌ ${filename} no existe`;
        }
    } catch (error) {
        throw new Error(`Error al eliminar el plugin: ${error.message}`);
    }
};

parentPort.on('message', async (data) => {
    try {
        const { message, args } = data;
        
        parentPort.postMessage({
            type: 'log',
            message: `Procesando comando plg para usuario ${message.author.displayName}`
        });
        
        if (!args || !args.trim()) {
            return parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: {
                    text: '❌ Uso:\n.plg <url> - Instalar plugin\n.plg <nombre> - Eliminar plugin'
                }
            });
        }
        
        const input = args.trim();
        
        if (isValidUrl(input)) {
            const filename = await downloadPlugin(input);
            
            parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: {
                    text: `✅ Plugin instalado: ${filename}\n⚠️ Reinicia el bot`
                }
            });
        } else {
            const result = await deletePlugin(input);
            
            parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: {
                    text: `${result}\n⚠️ Reinicia el bot para aplicar`
                }
            });
        }
        
    } catch (error) {
        parentPort.postMessage({
            type: 'error',
            message: `Error: ${error.message}`
        });
        
        parentPort.postMessage({
            type: 'response',
            originalMessage: data.message,
            response: {
                text: `❌ ${error.message}`
            }
        });
    }
});
