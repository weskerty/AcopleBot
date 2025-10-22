
import { parentPort } from 'worker_threads';

// Definir ABMetaInfo como función vacía (solo sirve para que el handler lo parsee)
const ABMetaInfo = () => {};

// Metadata del plugin
ABMetaInfo({
    pattern: 'echo ?(.*)',
    url: '',
    sudo: false,
    desc: 'Repite el mensaje que envías',
    type: 'utilidad',
    deps: []
});

// Escuchar mensajes del PluginHandler
parentPort.on('message', async (data) => {
    try {
        const { message, args } = data;
        
        // Log a handler
        parentPort.postMessage({
            type: 'log',
            message: `Procesando echo para usuario ${message.author.displayName || message.author.username}`
        });
        
        // Procesar comando
        let response = args.trim();
        
        // Si no hay argumentos, mensaje por defecto
        if (!response) {
            response = 'Debe: .echo hola mundo';
        }
        
        parentPort.postMessage({
            type: 'log',
            message: `Echo completado: "${response}"`
        });
        
        // Enviar respuesta al handler
        parentPort.postMessage({
            type: 'response',
            originalMessage: message,
            response: {
                text: response
            }
        });
        
    } catch (error) {
        parentPort.postMessage({
            type: 'error',
            message: `Error: ${error.message}`
        });
    }
});