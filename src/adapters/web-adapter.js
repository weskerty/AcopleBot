import express from 'express';
import { WebSocketServer } from 'ws';
import redis from 'redis';
import crypto from 'crypto';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV = process.env;
const WEB_ADAPTER_ID = 'web-1';
const VALKEY_HOST = ENV.VALKEY_HOST || 'localhost';
const VALKEY_PORT = Number(ENV.VALKEY_PORT || 6379);
const WEB_PORT = Number(ENV.WEB_PORT || 3000);

const LOAD_RULES = () => {
    const r = [];
    let i = 1;
    while (ENV[`REGLA_${i}`]) {
        const v = ENV[`REGLA_${i}`];
        const rule = { ruleId: `REGLA_${i}`, targets: [], isAll: false };
        const parts = v.split(',');

        for (const p of parts) {
            const t = p.trim();
            if (t.startsWith('all:')) {
                rule.isAll = true;
                const [, aId, cId, dir] = t.split(':');
                rule.targets.push({ adapterId: aId.trim(), chatId: cId.trim(), direction: dir.trim() });
            } else {
                const seg = t.split(':');
                if (seg.length >= 3) {
                    const aId = seg[0].trim();
                    const cId = seg[1].trim();
                    const dir = seg[2].trim();
                    let chatId = cId, threadId = null;
                    if (cId.includes('/')) [chatId, threadId] = cId.split('/');
                    rule.targets.push({ adapterId: aId, chatId, threadId: threadId || null, direction: dir });
                }
            }
        }
        r.push(rule);
        i++;
    }
    return r;
};

const ROUTING_RULES = LOAD_RULES();

const C = {
    PLATFORM: 'web',
    CHANNEL: 'bot.On.AdaptadorMessage',
    HISTORY_KEY: 'history:global',
    INDEX_UNIVERSAL: 'index:universal:',
    CONFIG_PREFIX: 'config:web:',
    CHUNK_SIZE: 100,
    CACHE_SIZE: 500,
    CHAT_LIMIT: 20,
    MSG_LIMIT: 50
};

const REDIS_CONFIG = {
    socket: { host: VALKEY_HOST, port: VALKEY_PORT }
};

let publisherClient, subscriberClient, historyClient, configClient;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const msgCache = new Map();
const chatCache = new Map();

const INIT_REDIS = async () => {
    publisherClient = redis.createClient(REDIS_CONFIG);
    subscriberClient = redis.createClient(REDIS_CONFIG);
    historyClient = redis.createClient(REDIS_CONFIG);
    configClient = redis.createClient(REDIS_CONFIG);

    [publisherClient, subscriberClient, historyClient, configClient].forEach(c => {
        c.on('error', e => console.error('[WEB] Redis Error:', e));
    });

    await Promise.all([
        publisherClient.connect(),
                      subscriberClient.connect(),
                      historyClient.connect(),
                      configClient.connect()
    ]);

    console.log('[WEB] Conectado a Redis');
    console.log(`[WEB] Reglas cargadas: ${ROUTING_RULES.length}`);
};

const LOAD_MESSAGES = async (s, l) => {
    const t = await historyClient.lLen(C.HISTORY_KEY);
    const e = Math.max(0, t - s - l);
    const m = await historyClient.lRange(C.HISTORY_KEY, e, e + l - 1);
    return m.map(x => JSON.parse(x)).reverse();
};

const GET_UNIFIED_ID = (aId, cId) => {
    for (const rule of ROUTING_RULES) {
        const found = rule.targets.find(t =>
        t.adapterId === aId && t.chatId === cId
        );
        if (found) return rule.ruleId;
    }
    return `${aId}:${cId}`;
};

const GET_RULE_CHATS = (ruleId) => {
    const rule = ROUTING_RULES.find(r => r.ruleId === ruleId);
    return rule ? rule.targets : [];
};

const GROUP_BY_CHAT = (msgs) => {
    const g = new Map();

    msgs.forEach(m => {
        if (!m.conversation?.id) return;

        const uId = GET_UNIFIED_ID(m.adapterId, m.conversation.id);

        if (!g.has(uId)) {
            const isUnified = uId.startsWith('REGLA_');
            const targets = isUnified ? GET_RULE_CHATS(uId) : [];

            g.set(uId, {
                id: uId,
                adapterId: m.adapterId,
                chatId: m.conversation.id,
                name: m.conversation.name || 'Unknown',
                type: m.conversation.type || 'unknown',
                platform: isUnified ? 'unified' : m.platform,
                lastMsg: m.timestamp,
                lastText: m.message?.text || '',
                unread: 0,
                messages: [],
                isUnified: isUnified,
                unifiedNames: isUnified ? [] : null,
                targets: targets
            });
        }

        const chat = g.get(uId);
        chat.messages.push(m);

        if (m.timestamp > chat.lastMsg) {
            chat.lastMsg = m.timestamp;
            chat.lastText = m.message?.text || '';
        }

        if (chat.isUnified && m.conversation.name) {
            const name = `${m.conversation.name} (${m.platform.toUpperCase()})`;
            if (!chat.unifiedNames.includes(name)) {
                chat.unifiedNames.push(name);
            }
        }
    });

    return Array.from(g.values()).sort((a, b) => b.lastMsg - a.lastMsg);
};

const GET_CHATS = async (o, l, userId = 'web-user') => {
    const k = `chats_${o}_${l}_${userId}`;
    if (chatCache.has(k)) return chatCache.get(k);

    const msgs = await LOAD_MESSAGES(0, C.CHUNK_SIZE * 3);
    const chats = GROUP_BY_CHAT(msgs);

    for (const chat of chats) {
        const lastReadKey = `${C.CONFIG_PREFIX}${userId}:lastRead:${chat.id}`;
        const lastRead = await configClient.get(lastReadKey);
        if (lastRead) {
            chat.unread = chat.messages.filter(m => m.timestamp > parseInt(lastRead)).length;
        } else {
            chat.unread = chat.messages.length;
        }
    }

    const page = chats.slice(o, o + l);

    chatCache.set(k, { chats: page, total: chats.length });
    setTimeout(() => chatCache.delete(k), 60000);

    return { chats: page, total: chats.length };
};

const GET_CHAT_HISTORY = async (cId, b, l) => {
    const k = `hist_${cId}_${b}_${l}`;
    if (msgCache.has(k)) return msgCache.get(k);

    const t = await historyClient.lLen(C.HISTORY_KEY);
    const msgs = await LOAD_MESSAGES(0, Math.min(t, 1000));

    const isUnified = cId.startsWith('REGLA_');
    let filtered;

    if (isUnified) {
        const targets = GET_RULE_CHATS(cId);
        filtered = msgs.filter(m => {
            if (!m.conversation?.id) return false;
            return targets.some(t =>
            t.adapterId === m.adapterId && t.chatId === m.conversation.id
            );
        });
    } else {
        const [targetAdapterId, targetChatId] = cId.split(':');
        filtered = msgs.filter(m => {
            if (!m.conversation?.id) return false;
            const conversationMatch = m.conversation.id === targetChatId;
            const adapterMatch = m.adapterId === targetAdapterId;
            const sameConversation = conversationMatch && (
                adapterMatch ||
                GET_UNIFIED_ID(m.adapterId, m.conversation.id) === cId
            );
            return sameConversation;
        });
    }

    let result = filtered;
    if (b) {
        const idx = filtered.findIndex(m => m.timestamp < b);
        if (idx !== -1) result = filtered.slice(idx, idx + l);
    } else {
        result = filtered.slice(-l);
    }

    msgCache.set(k, result);
    setTimeout(() => msgCache.delete(k), 30000);

    return result;
};

const FIND_MSG_BY_ID = async (uId) => {
    const t = await historyClient.lLen(C.HISTORY_KEY);
    const msgs = await LOAD_MESSAGES(0, Math.min(t, C.CHUNK_SIZE * 5));
    return msgs.find(m => m.universalId === uId);
};

const CREATE_UNIVERSAL_MSG = async (txt, cId, rId) => {
    let targetAdapterId, targetChatId;

    if (cId.startsWith('REGLA_')) {
        const targets = GET_RULE_CHATS(cId);
        const webTarget = targets.find(t => t.direction === 'in' || t.direction === 'inout');
        if (webTarget) {
            targetAdapterId = webTarget.adapterId;
            targetChatId = webTarget.chatId;
        } else {
            targetAdapterId = targets[0].adapterId;
            targetChatId = targets[0].chatId;
        }
    } else {
        [targetAdapterId, targetChatId] = cId.split(':');
    }

    let replyTo = null;
    if (rId) {
        const orig = await FIND_MSG_BY_ID(rId);
        if (orig) {
            replyTo = {
                messageId: orig.message?.id || '',
                universalId: orig.universalId,
                text: (orig.message?.text || '').substring(0, 100),
                author: orig.author
            };
        }
    }

    const msgs = await LOAD_MESSAGES(0, 100);
    const chatMsgs = msgs.filter(m =>
    m.conversation?.id && m.adapterId === targetAdapterId && m.conversation.id === targetChatId
    );
    const lastChat = chatMsgs[0];

    return {
        universalId: crypto.randomUUID(),
        timestamp: Date.now(),
        platform: lastChat?.platform || C.PLATFORM,
        adapterId: targetAdapterId,
        eventType: 'message',
        server: lastChat?.server || { id: null, name: null },
        conversation: lastChat?.conversation || {
            id: targetChatId,
            name: 'Unknown',
            type: 'unknown'
        },
        thread: lastChat?.thread || { id: null, name: null },
        author: {
            id: 'web-user',
            username: 'Web',
            displayName: 'Web',
            avatarUrl: null,
            avatarPath: null,
            bot: false
        },
        message: {
            id: crypto.randomUUID(),
            text: txt,
            textFormatted: null,
            replyTo: replyTo,
            edited: false,
            pinned: false
        },
        attachments: null,
        reaction: null,
        socialEvent: null,
        configChange: null,
        apiCall: null,
        raw: {},
        isPluginResponse: false
    };
};

const PUBLISH_MSG = async (msg) => {
    await publisherClient.publish(C.CHANNEL, JSON.stringify(msg));
    await historyClient.rPush(C.HISTORY_KEY, JSON.stringify(msg));
    msgCache.clear();
    chatCache.clear();
};

const SETUP_SUBSCRIBER = async () => {
    await subscriberClient.subscribe(C.CHANNEL, (m) => {
        try {
            const data = JSON.parse(m);
            wss.clients.forEach(c => {
                if (c.readyState === 1) {
                    c.send(JSON.stringify({ type: 'new_message', data }));
                }
            });
            msgCache.clear();
            chatCache.clear();
        } catch (e) {
            console.error('[WEB] Error en subscriber:', e);
        }
    });
};

app.use('/media', express.static(path.join(__dirname, '../..', 'src', 'media')));
app.use(express.static(path.join(__dirname, '../..', 'web')));
app.use(express.json());

app.get('/api/chats', async (req, res) => {
    try {
        const o = parseInt(req.query.offset || 0);
        const l = parseInt(req.query.limit || C.CHAT_LIMIT);
        const userId = req.query.userId || 'web-user';
        const data = await GET_CHATS(o, l, userId);
        res.json(data);
    } catch (e) {
        console.error('[WEB] Error /api/chats:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/chat/:id', async (req, res) => {
    try {
        const cId = req.params.id;
        const b = parseInt(req.query.before) || null;
        const l = parseInt(req.query.limit || C.MSG_LIMIT);
        const msgs = await GET_CHAT_HISTORY(cId, b, l);
        res.json({ messages: msgs });
    } catch (e) {
        console.error('[WEB] Error /api/chat:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/lastRead', async (req, res) => {
    try {
        const chatId = req.query.chatId;
        const userId = req.query.userId || 'web-user';
        if (!chatId) {
            return res.status(400).json({ error: 'chatId requerido' });
        }
        const key = `${C.CONFIG_PREFIX}${userId}:lastRead:${chatId}`;
        const timestamp = await configClient.get(key);
        res.json({ timestamp: timestamp ? parseInt(timestamp) : 0 });
    } catch (e) {
        console.error('[WEB] Error /api/lastRead:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/send', async (req, res) => {
    try {
        const { text, chatId, replyTo } = req.body;
        if (!text || !chatId) {
            return res.status(400).json({ error: 'text y chatId requeridos' });
        }
        const msg = await CREATE_UNIVERSAL_MSG(text, chatId, replyTo);
        await PUBLISH_MSG(msg);
        res.json({ success: true, message: msg });
    } catch (e) {
        console.error('[WEB] Error /api/send:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/markRead', async (req, res) => {
    try {
        const { chatId, userId = 'web-user' } = req.body;
        if (!chatId) {
            return res.status(400).json({ error: 'chatId requerido' });
        }
        const key = `${C.CONFIG_PREFIX}${userId}:lastRead:${chatId}`;
        await configClient.set(key, Date.now().toString());
        chatCache.clear();
        res.json({ success: true });
    } catch (e) {
        console.error('[WEB] Error /api/markRead:', e);
        res.status(500).json({ error: e.message });
    }
});

wss.on('connection', (ws) => {
    console.log('[WEB] Cliente Conectado');

    ws.on('message', async (data) => {
        try {
            const { type, payload } = JSON.parse(data);

            if (type === 'send_message') {
                const { text, chatId, replyTo } = payload;
                const msg = await CREATE_UNIVERSAL_MSG(text, chatId, replyTo);
                await PUBLISH_MSG(msg);
                ws.send(JSON.stringify({ type: 'sent', data: msg }));
            }
        } catch (e) {
            console.error('[WEB] Error message:', e);
            ws.send(JSON.stringify({ type: 'error', error: e.message }));
        }
    });

    ws.on('close', () => {
        console.log('[WEB] Cliente Desconectado');
    });

    ws.on('error', (e) => {
        console.error('[WEB] Error WS:', e);
    });
});

const MAIN = async () => {
    await INIT_REDIS();
    await SETUP_SUBSCRIBER();

    server.listen(WEB_PORT, () => {
        console.log(`[WEB] Servidor en http://localhost:${WEB_PORT}`);
    });

    process.on('SIGINT', async () => {
        console.log('[WEB] Cerrando...');
        wss.close();
        await publisherClient.quit();
        await subscriberClient.quit();
        await historyClient.quit();
        await configClient.quit();
        process.exit(0);
    });
};

MAIN().catch(console.error);
