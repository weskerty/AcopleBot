import { parentPort } from 'worker_threads';
import fs from 'fs';
import path from 'path';

const ABMetaInfo = () => {};

ABMetaInfo({
    pattern: 'setvar ?(.*)',
           url: '',
           sudo: true,
           desc: 'Agregar o actualizar variables en .env',
           type: 'utilidad',
           deps: []
});

const ENV_PATH = path.join(process.cwd(), '.env');
const VAR_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

let pendingRule = null;
let ruleTimeout = null;

const RULE_TIMEOUT_MS = 60000;

const wrapValue = (val) => {
    const v = val.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        return v;
    }
    return `"${v}"`;
};

const normalizeVarName = (name) => {
    return name.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
};

const readEnvFile = async () => {
    try {
        if (fs.existsSync(ENV_PATH)) {
            return await fs.promises.readFile(ENV_PATH, 'utf-8');
        }
        return '';
    } catch (error) {
        throw new Error(`Error leyendo .env: ${error.message}`);
    }
};

const getEnvVar = async (varName) => {
    const content = await readEnvFile();
    const regex = new RegExp(`^${varName}\\s*=\\s*(.*)$`, 'm');
    const match = content.match(regex);
    return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
};

const updateEnvVar = async (key, value) => {
    try {
        let content = await readEnvFile();

        const varName = normalizeVarName(key);
        const regex = new RegExp(`^${varName}\\s*=\\s*.*$`, 'm');
        const wrappedValue = wrapValue(value);

        if (regex.test(content)) {
            content = content.replace(regex, `${varName}=${wrappedValue}`);
        } else {
            content = content.trim();
            if (content && !content.endsWith('\n')) {
                content += '\n';
            }
            content += `${varName}=${wrappedValue}\n`;
        }

        await fs.promises.writeFile(ENV_PATH, content, 'utf-8');

        return `${varName}=${wrappedValue}`;

    } catch (error) {
        throw new Error(`Error actualizando .env: ${error.message}`);
    }
};

const resetRuleTimeout = () => {
    if (ruleTimeout) {
        clearTimeout(ruleTimeout);
    }

    ruleTimeout = setTimeout(() => {
        if (pendingRule) {
            parentPort.postMessage({
                type: 'log',
                message: `REGLA_${pendingRule.ruleId} descartada por timeout`
            });
            pendingRule = null;
        }
        ruleTimeout = null;
    }, RULE_TIMEOUT_MS);
};

const handleIMSUDO = async (message) => {
    const currentSudoUsers = await getEnvVar('SUDO_USERS');

    if (currentSudoUsers) {
        return {
            type: 'response',
            originalMessage: message,
            response: {
                text: '⚠️ SUDO_USERS ya existe, no se puede usar IMSUDO'
            }
        };
    }

    const userId = message.author.id;
    const sudoUsers = ['web-user', userId];

    await updateEnvVar('SUDO_USERS', sudoUsers.join(','));

    return {
        type: 'response',
        originalMessage: message,
        response: {
            text: `✅ SUDO_USERS="web-user,${userId}"\n⚠️ Reinicia el bot para aplicar cambios`
        }
    };
};

const handleREGLA = async (message, args) => {
    const match = args.match(/^REGLA(\d+)$/i);

    if (!match) {
        return null;
    }

    const ruleNum = parseInt(match[1]);
    const ruleVarName = `REGLA_${ruleNum}`;

    if (ruleNum === 1) {
        const existingRule1 = await getEnvVar('REGLA_1');
        if (existingRule1) {
            return {
                type: 'response',
                originalMessage: message,
                response: {
                    text: '❌ REGLA_1 ya existe, usa otras reglas o edita el .env'
                }
            };
        }
    }

    if (pendingRule && pendingRule.ruleId !== ruleNum) {
        return {
            type: 'response',
            originalMessage: message,
            response: {
                text: `⚠️ Ya hay una regla en progreso: REGLA_${pendingRule.ruleId}\nTermina con .setvar REGLAOK o espera 60s`
            }
        };
    }

    const adapterId = message.adapterId.endsWith('-1')
    ? message.adapterId
    : message.adapterId.replace(/-\d+$/, '-1');
    const chatId = message.conversation.id;

    if (!pendingRule) {
        pendingRule = {
            ruleId: ruleNum,
            chats: []
        };
    }

    const alreadyAdded = pendingRule.chats.some(c =>
    c.adapterId === adapterId && c.chatId === chatId
    );

    if (alreadyAdded) {
        return {
            type: 'response',
            originalMessage: message,
            response: {
                text: `⚠️ Este chat ya fue agregado a REGLA_${ruleNum}`
            }
        };
    }

    pendingRule.chats.push({
        adapterId,
        chatId,
        timestamp: Date.now()
    });

    resetRuleTimeout();

    return {
        type: 'response',
        originalMessage: message,
        response: {
            text: `✅ Chat agregado a REGLA_${ruleNum} (${pendingRule.chats.length} chat(s))\n⏱️ 60s para agregar más o usa .setvar REGLAOK`
        }
    };
};

const handleREGLAOK = async (message) => {
    if (!pendingRule) {
        return {
            type: 'response',
            originalMessage: message,
            response: {
                text: '⚠️ No hay ninguna regla en progreso'
            }
        };
    }

    if (pendingRule.chats.length < 2) {
        pendingRule = null;
        if (ruleTimeout) {
            clearTimeout(ruleTimeout);
            ruleTimeout = null;
        }
        return {
            type: 'response',
            originalMessage: message,
            response: {
                text: '❌ Se necesitan al menos 2 chats para crear una regla'
            }
        };
    }

    const ruleValue = pendingRule.chats
    .map(c => `${c.adapterId}:${c.chatId}:inout`)
    .join(',');

    const ruleVarName = `REGLA_${pendingRule.ruleId}`;
    await updateEnvVar(ruleVarName, ruleValue);

    const chatCount = pendingRule.chats.length;
    const ruleId = pendingRule.ruleId;

    pendingRule = null;
    if (ruleTimeout) {
        clearTimeout(ruleTimeout);
        ruleTimeout = null;
    }

    return {
        type: 'response',
        originalMessage: message,
        response: {
            text: `✅ ${ruleVarName} creada con ${chatCount} chat(s)\n⚠️ Reinicia el bot para aplicar cambios`
        }
    };
};

parentPort.on('message', async (data) => {
    try {
        const { message, args } = data;

        if (!args || !args.trim()) {
            return parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: {
                    text: '❌ Uso:\n.setvar VARIABLE valor\n.setvar IMSUDO (añadir como SUDO)\n.setvar REGLA# (crear puente)\n.setvar REGLAOK (finalizar puente)'
                }
            });
        }

        const parts = args.trim().split(/\s+/);
        const varName = parts[0].toUpperCase();

        if (varName === 'IMSUDO') {
            const result = await handleIMSUDO(message);
            return parentPort.postMessage(result);
        }

        if (varName === 'REGLAOK') {
            const result = await handleREGLAOK(message);
            return parentPort.postMessage(result);
        }

        const reglaResult = await handleREGLA(message, varName);
        if (reglaResult) {
            return parentPort.postMessage(reglaResult);
        }

        if (!VAR_NAME_REGEX.test(varName)) {
            return parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: {
                    text: '❌ Nombre de variable inválido\nSolo letras, números y guiones bajos'
                }
            });
        }

        const varValue = parts.slice(1).join(' ');

        if (!varValue) {
            return parentPort.postMessage({
                type: 'response',
                originalMessage: message,
                response: {
                    text: '❌ Debes proporcionar un valor\nEjemplo: .setvar GROQ_API_KEY gsk-123'
                }
            });
        }

        const result = await updateEnvVar(varName, varValue);

        parentPort.postMessage({
            type: 'response',
            originalMessage: message,
            response: {
                text: `✅ ${result}\n⚠️ Reinicia el bot para aplicar cambios`
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
                text: `❌ ${error.message}`
            }
        });
    }
});
