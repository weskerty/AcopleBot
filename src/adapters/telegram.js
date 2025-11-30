
import TelegramBot from "node-telegram-bot-api";
import redis from "redis";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";



const ENV = process.env,
TELEGRAM_TOKEN = ENV.TELEGRAM_T1,
TELEGRAM_ID = "telegram-1",
TARGET_CHAT_ID = ENV.TARGET_CHAT_ID_1 || ENV.TARGET_CHAT_ID,
LOAD_RULES = () => {
  const e = [];
  let t = 1;
  for (; ENV[`REGLA_${t}`];) {
    const a = ENV[`REGLA_${t}`],
    r = {
      ruleId: `REGLA_${t}`,
      targets: [],
      isAll: !1
    },
    n = a.split(",");
    for (const e of n) {
      const t = e.trim();
      if (t.startsWith("all:")) {
        r.isAll = !0;
        const [, e, a, n] = t.split(":");
        r.targets.push({
          adapterId: e.trim(),
                       chatId: a.trim(),
                       direction: n.trim()
        })
      } else {
        const e = t.split(":");
        if (e.length >= 3) {
          const t = e[0].trim(),
          a = e[1].trim(),
          n = e[2].trim();
          let o = a,
          i = null;
          a.includes("/") && ([o, i] = a.split("/")), r.targets.push({
            adapterId: t,
            chatId: o,
            threadId: i || null,
            direction: n
          })
        }
      }
    }
    e.push(r), t++
  }
  return e
},
ROUTING_RULES = LOAD_RULES(),
VALKEY_HOST = ENV.VALKEY_HOST || 'localhost',
VALKEY_PORT = Number(ENV.VALKEY_PORT || 6379),
MEDIA_FOLDER = ENV.MEDIA_FOLDER || "src/media",
C = {
  PLATFORM: "telegram",
  CHANNEL: "bot.On.AdaptadorMessage",
  HISTORY_KEY: "history:global",
  INDEX_UNIVERSAL: "index:universal:",
  INDEX_PLATFORM: "index:platform:telegram:",
  SEARCH_LIMIT: 1e3,
  TEXT_LIMIT: 100,
  UUID_LENGTH: 8,
  EVENTS: {
    MESSAGE: "message",
    EDIT: "edit",
    DELETE: "delete",
    PIN: "pin",
    JOIN: "join",
    LEAVE: "leave",
    BAN: "ban",
    API: "api",
    REACTION: "reaction"
  },
  MEDIA: {
    IMAGE: "image",
    VIDEO: "video",
    AUDIO: "audio",
    VOICE: "voice",
    DOCUMENT: "document",
    STICKER: "sticker",
    GIF: "gif",
    VIDEO_NOTE: "video_note"
  },
  ERRORS: {
    REDIS: "Redis Error:",
    DOWNLOAD: "Error downloading file:",
    SEND: "Error enviando archivo:",
    PROCESS: "Error procesando evento",
    SUBSCRIBE: "Error procesando mensaje de suscripcion:",
    INDEX: "Error creating message index:",
    FIND: "Error finding message by universalId:"
  },
  MESSAGES: {
    CONNECTED: "Conectado a Valkey exitosamente",
    CONNECTION_ERROR: "Error conectando a Valkey:",
    DOWNLOAD_SUCCESS: "Archivo descargado:",
    MEDIA_NOT_FOUND: "Media no encontrada:",
    MEDIA_ERROR: "Error enviando"
  }
},
REDIS_CONFIG = {
  socket: {
    host: VALKEY_HOST,
    port: VALKEY_PORT
  }
};
let bot, botInfo, publisherClient, indexClient, subscriberClient;
const INIT_CLIENTS = async () => {
  if (!TELEGRAM_TOKEN) {
    console.error("No se encontro TELEGRAM_T1");
    process.exit(1)
  }
  publisherClient = redis.createClient(REDIS_CONFIG), indexClient = redis.createClient(REDIS_CONFIG), subscriberClient = redis.createClient(REDIS_CONFIG), [publisherClient, indexClient, subscriberClient].forEach((e => {
    e.on("error", (e => console.error(C.ERRORS.REDIS, e)))
  }));
  try {
    await Promise.all([publisherClient.connect(), indexClient.connect(), subscriberClient.connect()]), console.log(C.MESSAGES.CONNECTED), await SETUP_GLOBAL_SUBSCRIBER(subscriberClient)
  } catch (e) {
    console.error(C.MESSAGES.CONNECTION_ERROR, e), process.exit(1)
  }
  try {
    bot = new TelegramBot(TELEGRAM_TOKEN, {
      polling: !0
    }), botInfo = await bot.getMe(), console.log(`Bot ${botInfo.username} (${TELEGRAM_ID}) inicializado`), SETUP_EVENT_HANDLERS()
  } catch (e) {
    console.error(`Error inicializando bot ${TELEGRAM_ID}:`, e), process.exit(1)
  }
}, GENERATE_FILE_NAME = (e, t) => `${e}_${Date.now()}_${crypto.randomUUID().substring(0,C.UUID_LENGTH)}${t}`, DOWNLOAD_FILE = async (e, t) => {
  try {
    const a = await bot.getFile(e),
    r = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${a.file_path}`,
    n = path.join(MEDIA_FOLDER, t);
    return new Promise(((e, t) => {
      const a = fs.createWriteStream(n);
      (r.startsWith("https") ? https : http).get(r, (r => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return DOWNLOAD_FILE(r.headers.location, t).then(e).catch(t);
        200 === r.statusCode ? (r.pipe(a), a.on("finish", (() => {
          a.close(), e(n)
        })), a.on("error", t)) : t(new Error(`HTTP ${r.statusCode}: ${r.statusMessage}`))
      })).on("error", (e => {
        fs.unlink(n, (() => {})), t(e)
      }))
    }))
  } catch (e) {
    throw console.error(C.ERRORS.DOWNLOAD, e), e
  }
}, CREATE_MESSAGE_INDEX = async (e, t) => {
  try {
    const a = C.INDEX_UNIVERSAL + e;
    if (await indexClient.hSet(a, {
      universalId: e,
      platform: t.platform,
      adapterId: t.adapterId,
      messageId: t.message?.id || "",
      chatId: t.conversation.id,
      threadId: t.thread?.id || "",
      authorId: t.author.id,
      timestamp: t.timestamp.toString(),
                               text: t.message?.text || ""
    }), t.message?.id) {
      const a = `${C.INDEX_PLATFORM}${t.adapterId}:${t.message.id}`;
      await indexClient.set(a, e)
    }
  } catch (e) {
    console.error(C.ERRORS.INDEX, e)
  }
}, FIND_MESSAGE_BY_UNIVERSAL_ID = async e => {
  try {
    const t = C.INDEX_UNIVERSAL + e,
    a = await indexClient.hGetAll(t);
    return Object.keys(a).length > 0 ? a : null
  } catch (e) {
    return console.error(C.ERRORS.FIND, e), null
  }
}, FIND_ORIGINAL_MESSAGE = async (e, t) => {
  try {
    const a = `${C.INDEX_PLATFORM}${TELEGRAM_ID}:${e}`;
    let r = await indexClient.get(a);
    if (r) return await FIND_MESSAGE_BY_UNIVERSAL_ID(r);
    const n = await indexClient.lLen(C.HISTORY_KEY),
    o = Math.min(n, C.SEARCH_LIMIT);
    for (let a = 0; a < o; a++) {
      const r = await indexClient.lIndex(C.HISTORY_KEY, -1 - a);
      if (r) try {
        const a = JSON.parse(r);
        if (a.platform === C.PLATFORM && a.message?.id === e && (!t || !a.thread?.id || a.thread.id === t)) return a
      } catch (e) {
        continue
      }
    }
    return null
  } catch (e) {
    return console.error("Error finding original message:", e), null
  }
}, GET_MEDIA_INFO = e => {
  const t = [{
    key: "photo",
    type: C.MEDIA.IMAGE,
    mime: "image/jpeg",
    ext: ".jpg",
    getFile: e => e[e.length - 1]
  }, {
    key: "video",
    type: C.MEDIA.VIDEO,
    mime: "video/mp4",
    ext: ".mp4"
  }, {
    key: "video_note",
    type: C.MEDIA.VIDEO_NOTE,
    mime: "video/mp4",
    ext: ".mp4"
  }, {
    key: "document",
    type: C.MEDIA.DOCUMENT,
    mime: "application/octet-stream",
    ext: "",
    getFile: e => e
  }, {
    key: "audio",
    type: C.MEDIA.AUDIO,
    mime: "audio/mpeg",
    ext: ".mp3"
  }, {
    key: "voice",
    type: C.MEDIA.VOICE,
    mime: "audio/ogg",
    ext: ".ogg"
  }, {
    key: "sticker",
    type: C.MEDIA.STICKER,
    mime: "image/webp",
    ext: ".webp"
  }, {
    key: "animation",
    type: C.MEDIA.GIF,
    mime: "video/mp4",
    ext: ".mp4"
  }];
  for (const a of t)
    if (e[a.key]) {
      const t = a.getFile ? a.getFile(e[a.key]) : e[a.key],
      r = "document" === a.key && t.file_name ? path.extname(t.file_name) : a.ext;
      return {
        fileId: t.file_id,
        type: a.type,
        mimeType: t.mime_type || a.mime,
        fileName: t.file_name || GENERATE_FILE_NAME(a.type, r),
        width: t.width || null,
        height: t.height || null,
        duration: t.duration || null
      }
    } return null
}, HAS_THREAD_IN_RULES = (e, t) => {
  for (const a of ROUTING_RULES)
    for (const r of a.targets)
      if (r.adapterId === e && r.chatId === t && r.threadId) return !0;
      return !1
}, CREATE_BASE_MESSAGE = (e, t, a = {}) => {
  const r = e.message || e.edited_message || e.channel_post || e.edited_channel_post || e,
  n = r.chat ? r.chat.id.toString() : e.chat_id || "unknown",
  o = r.message_thread_id && HAS_THREAD_IN_RULES(TELEGRAM_ID, n) ? r.message_thread_id.toString() : null;
  return {
    universalId: crypto.randomUUID(),
    timestamp: Date.now(),
    platform: C.PLATFORM,
    adapterId: TELEGRAM_ID,
    eventType: t,
    server: {
      id: null,
      name: null
    },
    conversation: {
      id: n,
      name: r.chat && (r.chat.title || r.chat.first_name || r.chat.username) || "Unknown",
      type: r.chat ? "private" === r.chat.type ? "dm" : r.chat.type : "unknown"
    },
    thread: {
      id: o,
      name: null
    },
    author: {
      id: r.from ? r.from.id.toString() : e.user_id || "system",
      username: r.from?.username || null,
      displayName: r.from ? `${r.from.first_name||""} ${r.from.last_name||""}`.trim() || "Unknown" : "System",
      avatarUrl: null,
      avatarPath: null,
      bot: r.from?.is_bot || !1
    },
    message: null,
    attachments: null,
    reaction: null,
    socialEvent: null,
    configChange: null,
    apiCall: a.apiCall || null,
    raw: e
  }
}, PROCESS_MESSAGE = async (e, t, a, r) => {
  if ([C.EVENTS.MESSAGE, C.EVENTS.EDIT, C.EVENTS.DELETE, C.EVENTS.PIN].includes(a)) {
    if (e.message = {
      id: t.message_id ? t.message_id.toString() : r.message_id || "",
        text: t.text || t.caption || r.text || "",
        textFormatted: null,
        replyTo: null,
        edited: a === C.EVENTS.EDIT,
        pinned: a === C.EVENTS.PIN
    }, t.reply_to_message) {
      const a = await FIND_ORIGINAL_MESSAGE(t.reply_to_message.message_id.toString(), t.message_thread_id ? t.message_thread_id.toString() : null);
      e.message.replyTo = {
        messageId: t.reply_to_message.message_id.toString(),
        universalId: a ? a.universalId : null,
        text: (t.reply_to_message.text || t.reply_to_message.caption || "").substring(0, C.TEXT_LIMIT),
        author: {
          id: a && a.author?.id || t.reply_to_message.from?.id?.toString(),
          username: a && a.author?.username || t.reply_to_message.from?.username,
          displayName: a ? a.author?.displayName : t.reply_to_message.from ? `${t.reply_to_message.from.first_name||""} ${t.reply_to_message.from.last_name||""}`.trim() : "Unknown",
          avatarUrl: a ? a.author?.avatarUrl : null
        }
      }
    }
    r.newText && (e.message.text = r.newText)
  }
  const n = GET_MEDIA_INFO(t);
  if (n) try {
    const a = await DOWNLOAD_FILE(n.fileId, n.fileName);
    e.attachments = [{
      type: n.type,
      fileUrl: null,
      filePath: a,
      filename: n.fileName,
      mimeType: n.mimeType,
      size: null,
      width: n.width,
      height: n.height,
      duration: n.duration,
      caption: t.caption || null
    }]
  } catch (a) {
    console.error(`${C.ERRORS.DOWNLOAD} ${n.fileName}:`, a), e.attachments = [{
      type: n.type,
      fileUrl: null,
      filePath: null,
      filename: n.fileName,
      mimeType: n.mimeType,
      size: null,
      width: n.width,
      height: n.height,
      duration: n.duration,
      caption: t.caption || null
    }]
  } [C.EVENTS.JOIN, C.EVENTS.LEAVE, C.EVENTS.BAN].includes(a) && (e.socialEvent = {
    action: r.action || a,
    targetUser: {
      id: r.targetUserId || "unknown",
      username: r.targetUsername || null,
      displayName: r.targetDisplayName || "Unknown"
    },
    moderator: null,
    reason: r.reason || null,
    duration: null,
    role: null
  })
}, CREATE_UNIVERSAL_MESSAGE = async (e, t, a = {}) => {
  const r = e.message || e.edited_message || e.channel_post || e.edited_channel_post || e,
  n = CREATE_BASE_MESSAGE(e, t, a);
  return await PROCESS_MESSAGE(n, r, t, a), n
}, PUBLISH_EVENT = async (e, t, a = {}) => {
  try {
    const r = await CREATE_UNIVERSAL_MESSAGE(e, t, a);
    await publisherClient.publish(C.CHANNEL, JSON.stringify(r)), await indexClient.rPush(C.HISTORY_KEY, JSON.stringify(r)), r.message && await CREATE_MESSAGE_INDEX(r.universalId, r)
  } catch (e) {
    console.error(`${C.ERRORS.PROCESS} ${t} (${TELEGRAM_ID}):`, e)
  }
}, FIND_TELEGRAM_MESSAGE_BY_UNIVERSAL_ID = async (e, t, a) => {
  try {
    const r = C.INDEX_UNIVERSAL + e,
    n = await indexClient.hGetAll(r);
    if (0 === Object.keys(n).length) return null;
    if (n.platform === C.PLATFORM && n.adapterId === TELEGRAM_ID && n.chatId === t && (n.threadId || "") === (a || "") && n.messageId) return parseInt(n.messageId);
    const o = await indexClient.lLen(C.HISTORY_KEY),
    i = Math.min(o, C.SEARCH_LIMIT);
    for (let r = 0; r < i; r++) {
      const n = await indexClient.lIndex(C.HISTORY_KEY, -1 - r);
      if (n) try {
        const r = JSON.parse(n);
        if (r.universalId === e && r.platform === C.PLATFORM && r.adapterId === TELEGRAM_ID && r.conversation.id === t && (r.thread?.id || "") === (a || "")) return parseInt(r.message?.id)
      } catch (e) {
        continue
      }
    }
    return null
  } catch (e) {
    return console.error("Error finding Telegram message:", e), null
  }
}, EXECUTE_API_CALL = async e => {
  try {
    if ("node-telegram-bot-api" === e.api) {
      const t = e.command;
      if (t.includes("bot.")) {
        const e = t.replace("bot.", ""),
        a = eval(`bot.${e}`);
        if ("function" == typeof a) return await a
      }
    }
  } catch (e) {
    console.error("Error executing API call:", e)
  }
}, SHOULD_SEND_MESSAGE = (e, t, a, r) => {
  const n = `${e.adapterId}:${e.conversation.id}${e.thread?.id?`/${e.thread.id}`:""}`,
  o = `${t}:${a}${r?`/${r}`:""}`;
  if (n === o) {
    if (e.isPluginResponse) return !0;
    return !1
  }
  for (const n of ROUTING_RULES) {
    if (n.isAll) {
      const o = n.targets.find((e => e.adapterId === t && e.chatId === a && (r ? e.threadId === r : null === e.threadId && !r) && ("in" === e.direction || "inout" === e.direction)));
      if (o) return !0
    } else {
      const o = n.targets.find((t => t.adapterId === e.adapterId && t.chatId === e.conversation.id && (e.thread?.id ? t.threadId === e.thread.id : null === t.threadId) && ("out" === t.direction || "inout" === t.direction)));
      if (o) {
        const e = n.targets.find((e => e.adapterId === t && e.chatId === a && (r ? e.threadId === r : null === e.threadId && !r) && ("in" === e.direction || "inout" === e.direction)));
        if (e) return !0
      }
    }
  }
  return !1
};
fs.existsSync(MEDIA_FOLDER) || fs.mkdirSync(MEDIA_FOLDER, {
  recursive: !0
});
const SEND_METHODS = {
  [C.MEDIA.IMAGE]: (e, t, a) => bot.sendPhoto(e, t, a),
  [C.MEDIA.VIDEO]: (e, t, a) => bot.sendVideo(e, t, a),
  [C.MEDIA.VIDEO_NOTE]: (e, t, a) => bot.sendVideoNote(e, t, a),
  [C.MEDIA.AUDIO]: (e, t, a) => bot.sendAudio(e, t, a),
  [C.MEDIA.VOICE]: (e, t, a) => bot.sendVoice(e, t, a),
  [C.MEDIA.DOCUMENT]: (e, t, a) => bot.sendDocument(e, t, a),
  [C.MEDIA.STICKER]: (e, t, a) => bot.sendSticker(e, t, a),
  [C.MEDIA.GIF]: (e, t, a) => bot.sendAnimation(e, t, a)
},
SEND_UNIVERSAL_MESSAGE_TO_TELEGRAM = async e => {
  try {
    if (e.apiCall) return void await EXECUTE_API_CALL(e.apiCall);
    const t = [];
    for (const a of ROUTING_RULES)
      for (const r of a.targets) r.adapterId === TELEGRAM_ID && SHOULD_SEND_MESSAGE(e, r.adapterId, r.chatId, r.threadId) && t.push(r);
      for (const a of t) {
        const t = a.chatId,
        r = a.threadId;
        if (e.platform === C.PLATFORM && e.adapterId === TELEGRAM_ID && e.conversation.id === t && (e.thread?.id || null) === (r || null) && !e.isPluginResponse) continue;
        let n = null;
        if (e.message?.replyTo?.universalId) {
          n = await FIND_TELEGRAM_MESSAGE_BY_UNIVERSAL_ID(e.message.replyTo.universalId, t, r)
        }
        const o = e.platform.toUpperCase(),
        i = e.author.displayName || "Usuario Desconocido",
        s = e.conversation.name || "";
        let l = e.message?.text || "";
        e.isPluginResponse || (l = `[${o}] ${i} (${s}):\n${l}`);
        const c = {};
        r && (c.message_thread_id = parseInt(r)), n && (c.reply_to_message_id = n);
        let d = null;
        try {
          if (e.attachments && e.attachments.length > 0) {
            const a = e.attachments[0],
            r = l || a.caption || "";
            if (a.filePath && fs.existsSync(a.filePath)) {
              const e = SEND_METHODS[a.type];
              e && (a.type === C.MEDIA.VIDEO_NOTE || a.type === C.MEDIA.STICKER ? (d = await e(t, a.filePath, c), r && await bot.sendMessage(t, r, c)) : d = await e(t, a.filePath, {
                ...c,
                caption: r
              }))
            } else d = await bot.sendMessage(t, `${C.MESSAGES.MEDIA_NOT_FOUND} ${a.filename}\n\n${r}`, c)
          } else l && (d = await bot.sendMessage(t, l, c));
          d && await CREATE_MESSAGE_INDEX(e.universalId, {
            universalId: e.universalId,
            platform: C.PLATFORM,
            adapterId: TELEGRAM_ID,
            message: {
              id: d.message_id.toString()
            },
            conversation: {
              id: t
            },
            thread: {
              id: r || null
            },
            author: {
              id: "system"
            },
            timestamp: Date.now()
          })
        } catch (e) {
          console.error(`[TELEGRAM] Error enviando a ${t}${r?`/${r}`:""}: ${e.message}`)
        }
      }
  } catch (e) {
    console.error(`Error procesando mensaje (${TELEGRAM_ID}):`, e)
  }
}, SETUP_GLOBAL_SUBSCRIBER = async e => {
  await e.subscribe(C.CHANNEL, (async (e, t) => {
    try {
      const t = JSON.parse(e);
      if (t.author?.bot === !0 && !t.isPluginResponse) return;
      await SEND_UNIVERSAL_MESSAGE_TO_TELEGRAM(t)
    } catch (e) {
      console.error(`${C.ERRORS.SUBSCRIBE}:`, e)
    }
  }))
}, SETUP_EVENT_HANDLERS = () => {
  bot.on("message", (e => PUBLISH_EVENT(e, C.EVENTS.MESSAGE))), bot.on("edited_message", (e => PUBLISH_EVENT(e, C.EVENTS.EDIT, {
    newText: e.text || e.caption || ""
  }))), bot.on("channel_post", (e => PUBLISH_EVENT(e, C.EVENTS.MESSAGE))), bot.on("edited_channel_post", (e => PUBLISH_EVENT(e, C.EVENTS.EDIT, {
    newText: e.text || e.caption || ""
  })));
  [
    ["inline_query", e => ({
      text: `Inline query: ${e.query}`,
      apiCall: {
        command: "inline_query"
      }
    })],
    ["chosen_inline_result", e => ({
      text: `Chosen inline: ${e.result_id}`,
      apiCall: {
        command: "chosen_inline_result"
      }
    })],
    ["callback_query", e => ({
      text: `Callback query: ${e.data||""}`,
      apiCall: {
        command: "callback_query"
      }
    })],
    ["shipping_query", e => ({
      text: `Shipping query: ${e.id}`,
      apiCall: {
        command: "shipping_query"
      }
    })],
    ["pre_checkout_query", e => ({
      text: `Pre checkout: ${e.total_amount}`,
      apiCall: {
        command: "pre_checkout_query"
      }
    })],
    ["poll", e => ({
      text: `Poll: ${e.question}`,
      apiCall: {
        command: "poll"
      }
    })],
    ["poll_answer", e => ({
      text: `Poll answer: ${e.option_ids}`,
      apiCall: {
        command: "poll_answer"
      }
    })]
  ].forEach((([e, t]) => {
    bot.on(e, (e => PUBLISH_EVENT(e, C.EVENTS.API, t(e))))
  })), bot.on("new_chat_members", (e => {
    e.new_chat_members.forEach((t => {
      PUBLISH_EVENT(e, C.EVENTS.JOIN, {
        text: `Nuevo miembro: ${t.first_name||t.username}`,
        action: C.EVENTS.JOIN,
        targetUserId: t.id.toString(),
                    targetUsername: t.username,
                    targetDisplayName: `${t.first_name||""} ${t.last_name||""}`.trim(),
                    reason: "joined"
      })
    }))
  })), bot.on("left_chat_member", (e => {
    const t = e.left_chat_member;
    PUBLISH_EVENT(e, C.EVENTS.LEAVE, {
      text: `Miembro salio: ${t.first_name||t.username}`,
      action: C.EVENTS.LEAVE,
      targetUserId: t.id.toString(),
                  targetUsername: t.username,
                  targetDisplayName: `${t.first_name||""} ${t.last_name||""}`.trim(),
                  reason: "left"
    })
  })), bot.on("error", (e => {
    console.error(`Bot error (${botInfo.username}):`, e), PUBLISH_EVENT({
      error: e.message
    }, C.EVENTS.API, {
      text: `Bot error: ${e.message}`,
      apiCall: {
        command: "error"
      }
    })
  })), bot.on("polling_error", (e => {
    console.error(`Polling error (${botInfo.username}):`, e), PUBLISH_EVENT({
      error: e.message
    }, C.EVENTS.API, {
      text: `Polling error: ${e.message}`,
      apiCall: {
        command: "polling_error"
      }
    })
  }))
}, MAIN = async () => {
  await INIT_CLIENTS(), process.on("SIGINT", (async () => {
    await bot.close(), await publisherClient.quit(), await indexClient.quit(), await subscriberClient.quit(), process.exit(0)
  })), await PUBLISH_EVENT({
    botId: botInfo.id
  }, C.EVENTS.API, {
    text: `${botInfo.username} conectado`,
    apiCall: {
      command: "bot_ready"
    }
  }), console.log(`Ejecutando ${TELEGRAM_ID}`)
};
MAIN().catch(console.error);
