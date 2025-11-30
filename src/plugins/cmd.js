import { parentPort } from 'worker_threads';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const ABMetaInfo = () => {};

ABMetaInfo({
    pattern: 'cmd ?(.*)',
    url: '',
    sudo: true,
    desc: 'Ejecuta comandos en el sistema',
    type: 'machine',
    deps: []
});

parentPort.on('message', async (data) => {
    try {
        const { message, args } = data;
        
        parentPort.postMessage({
            type: 'log',
            message: `Ejecutando comando para usuario ${message.author.displayName}`
        });
        
        const command = args.trim() || 'ls';
        
        if (!command) {
            parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: {
                    text: '❌ Debes especificar un comando'
                }
            });
            return;
        }
        
        try {
            const { stdout, stderr } = await execAsync(command, {
                timeout: 30000,
                maxBuffer: 1024 * 1024 * 5
            });
            
            const response = [
                stdout.trim() || '',
                stderr.trim() ? `⚠️ ${stderr.trim()}` : ''
            ].filter(line => line).join('\n') || '✅ Comando ejecutado sin salida';
            
            parentPort.postMessage({
                type: 'log',
                message: `Comando completado: ${command}`
            });
            
            parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: {
                    text: response
                }
            });
            
        } catch (error) {
            const errorResponse = [
                error.stdout?.trim() || '',
                error.stderr?.trim() ? `⚠️ ${error.stderr.trim()}` : '',
                `❌ ${error.message}`
            ].filter(line => line).join('\n');
            
            parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: {
                    text: errorResponse
                }
            });
        }
        
    } catch (error) {
        parentPort.postMessage({
            type: 'error',
            message: `Error: ${error.message}`
        });
    }
});