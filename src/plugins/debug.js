import { parentPort } from 'worker_threads';
import redis from 'redis';

const ABMetaInfo = () => {};
ABMetaInfo({
    pattern: 'citedbg',
    url: '',
    sudo: true,
    desc: 'Debug de citas entre plataformas',
    type: 'debug',
    deps: []
});

let rc = null;

async function initRedis() {
    if (rc) return rc;

    const host = process.env.VALKEY_HOST || 'localhost';
    const port = Number(process.env.VALKEY_PORT || 6379);

    rc = redis.createClient({
        socket: { host, port }
    });

    await rc.connect();
    return rc;
}

parentPort.on('message', async (data) => {
    try {
        const { message, fullContext } = data;

        await initRedis();

        let report = '=== DIAGNÓSTICO DE CITAS ===\n\n';

        // 1. Info básica del mensaje actual
        report += `📍 MENSAJE ACTUAL:\n`;
        report += `  Platform: ${message.platform}\n`;
        report += `  AdapterId: ${message.adapterId}\n`;
        report += `  UniversalId: ${message.universalId}\n`;
        report += `  MessageId: ${message.message?.id}\n`;
        report += `  Text: ${message.message?.text?.substring(0, 50)}...\n\n`;

        // 2. Verificar si es una respuesta
        if (message.message?.replyTo) {
            report += `📎 REPLY TO (mensaje original):\n`;
            report += `  MessageId: ${message.message.replyTo.messageId}\n`;
            report += `  UniversalId: ${message.message.replyTo.universalId}\n`;
            report += `  Author: ${message.message.replyTo.author?.displayName}\n`;
            report += `  Text: ${message.message.replyTo.text}\n\n`;

            // 3. Buscar en índice p2u
            const pk = `${message.adapterId}:${message.message.replyTo.messageId}`;
            report += `🔍 BÚSQUEDA EN idx:p2u con key "${pk}":\n`;
            const foundUniversalId = await rc.hGet('idx:p2u', pk);
            report += `  Resultado: ${foundUniversalId || 'NOT FOUND'}\n\n`;

            // 4. Si tiene universalId, buscar en índice u
            if (message.message.replyTo.universalId) {
                const idxKey = `idx:u:${message.message.replyTo.universalId}`;
                report += `🔍 BÚSQUEDA EN ${idxKey}:\n`;
                const idxData = await rc.hGet(idxKey, 'data');
                if (idxData) {
                    const parsed = JSON.parse(idxData);
                    report += `  ✅ ENCONTRADO\n`;
                    report += `  Platform: ${parsed.platform}\n`;
                    report += `  AdapterId: ${parsed.adapterId}\n`;
                    report += `  MessageId: ${parsed.message?.id}\n`;
                    report += `  HasAttachments: ${parsed.attachments ? 'YES' : 'NO'}\n\n`;
                } else {
                    report += `  ❌ NO ENCONTRADO\n\n`;
                }
            }

            // 5. Verificar fullContext
            report += `📦 FULL CONTEXT:\n`;
            if (fullContext?.message?.replyTo) {
                report += `  ✅ Tiene replyTo completo\n`;
                report += `  Platform: ${fullContext.message.replyTo.platform}\n`;
                report += `  UniversalId: ${fullContext.message.replyTo.universalId}\n`;
                report += `  HasAttachments: ${fullContext.message.replyTo.attachments ? 'YES' : 'NO'}\n\n`;
            } else {
                report += `  ❌ NO tiene replyTo completo\n\n`;
            }
        } else {
            report += `❌ Este mensaje NO es una respuesta a otro mensaje\n\n`;
        }

        // 6. Listar últimos 5 mensajes en history
        report += `📚 ÚLTIMOS 5 MENSAJES EN HISTORY:\n`;
        const len = await rc.lLen('history:global');
        for (let i = 0; i < Math.min(5, len); i++) {
            const msgStr = await rc.lIndex('history:global', -1 - i);
            if (msgStr) {
                const msg = JSON.parse(msgStr);
                report += `  ${i + 1}. [${msg.platform}] ${msg.adapterId} | UnivId: ${msg.universalId.substring(0, 8)}... | MsgId: ${msg.message?.id || 'N/A'}\n`;
            }
        }
        report += `\n`;

        // 7. Verificar índices p2u para este adaptador
        report += `🗂️ ÍNDICES p2u PARA ${message.adapterId}:\n`;
        const allP2U = await rc.hGetAll('idx:p2u');
        let count = 0;
        for (const [key, val] of Object.entries(allP2U)) {
            if (key.startsWith(message.adapterId)) {
                report += `  ${key} -> ${val.substring(0, 8)}...\n`;
                count++;
                if (count >= 10) {
                    report += `  ... (mostrando solo 10)\n`;
                    break;
                }
            }
        }
        if (count === 0) {
            report += `  ❌ NO hay índices para este adaptador\n`;
        }
        report += `\n`;

        // 8. Test de plugin response
        if (message.author?.id === 'bot_plugin') {
            report += `🤖 ESTE ES UN MENSAJE DE PLUGIN\n`;
            report += `  isPluginResponse: ${message.isPluginResponse}\n`;
            report += `  Debería tener replyTo con universalId del comando original\n\n`;
        }

        parentPort.postMessage({
            type: 'response',
            originalMessage: message,
            response: { text: report }
        });

    } catch (err) {
        parentPort.postMessage({
            type: 'error',
            message: `Error: ${err.message}\n${err.stack}`
        });

        parentPort.postMessage({
            type: 'response',
            originalMessage: data.message,
            response: { text: `❌ Error: ${err.message}` }
        });
    }
});
