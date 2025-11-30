

import {
  Client,
  GatewayIntentBits,
  Partials,
  AttachmentBuilder
} from "discord.js";
import redis from "redis";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";



const ENV = process.env,
  DISCORD_TOKEN = ENV.DISCORD_T1,
  DISCORD_ID = "discord-1",
  LOAD_RULES = () => {
    const e = [];
    let t = 1;
    for (; ENV[`REGLA_${t}`];) {
      const s = ENV[`REGLA_${t}`],
        a = {
          ruleId: `REGLA_${t}`,
          targets: [],
          isAll: !1
        },
        r = s.split(",");
      for (const e of r) {
        const t = e.trim();
        if (t.startsWith("all:")) {
          a.isAll = !0;
          const [, e, s, r] = t.split(":");
          a.targets.push({
            adapterId: e.trim(),
            chatId: s.trim(),
            direction: r.trim()
          })
        } else {
          const e = t.split(":");
          if (e.length >= 3) {
            const t = e[0].trim(),
              s = e[1].trim(),
              r = e[2].trim();
            let i = s,
              n = null;
            s.includes("/") && ([i, n] = s.split("/")), a.targets.push({
              adapterId: t,
              chatId: i,
              threadId: n || null,
              direction: r
            })
          }
        }
      }
      e.push(a), t++
    }
    return e
  },
  ROUTING_RULES = LOAD_RULES(),
  VALKEY_HOST = ENV.VALKEY_HOST || 'localhost',
  VALKEY_PORT = Number(ENV.VALKEY_PORT || 6379),
  MEDIA_FOLDER = ENV.MEDIA_FOLDER || "src/media",
  C = {
    PLATFORM: "discord",
    CHANNEL: "bot.On.AdaptadorMessage",
    HISTORY_KEY: "history:global",
    INDEX_UNIVERSAL: "index:universal:",
    INDEX_PLATFORM: "index:platform:discord:",
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
let client, publisherClient, indexClient, subscriberClient;
const INIT_CLIENTS = async () => {
  if (!DISCORD_TOKEN) {
    console.error("No se encontro DISCORD_T1");
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
    client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMessageReactions],
      partials: [Partials.Channel, Partials.Message, Partials.Reaction]
    }), client.once("ready", (() => {
      console.log(`Bot ${client.user.tag} (${DISCORD_ID}) inicializado`), PUBLISH_EVENT({
        botId: client.user.id
      }, C.EVENTS.API, {
        text: `${client.user.tag} conectado`,
        apiCall: {
          command: "bot_ready"
        }
      })
    })), SETUP_EVENT_HANDLERS(), await client.login(DISCORD_TOKEN)
  } catch (e) {
    console.error(`Error inicializando bot ${DISCORD_ID}:`, e), process.exit(1)
  }
}, GENERATE_FILE_NAME = (e, t) => `${e}_${Date.now()}_${crypto.randomUUID().substring(0,C.UUID_LENGTH)}${t}`, DOWNLOAD_FILE = async (e, t) => {
  try {
    const s = path.join(MEDIA_FOLDER, t);
    return new Promise(((t, a) => {
      const r = fs.createWriteStream(s),
        i = e.startsWith("https") ? https : http;
      i.get(e, (e => {
        if (e.statusCode >= 300 && e.statusCode < 400 && e.headers.location) return DOWNLOAD_FILE(e.headers.location, t).then(t).catch(a);
        200 === e.statusCode ? (e.pipe(r), r.on("finish", (() => {
          r.close(), t(s)
        })), r.on("error", a)) : a(new Error(`HTTP ${e.statusCode}: ${e.statusMessage}`))
      })).on("error", (e => {
        fs.unlink(s, (() => {})), a(e)
      }))
    }))
  } catch (e) {
    throw console.error(C.ERRORS.DOWNLOAD, e), e
  }
}, CREATE_MESSAGE_INDEX = async (e, t) => {
  try {
    const s = C.INDEX_UNIVERSAL + e;
    if (await indexClient.hSet(s, {
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
      const s = `${C.INDEX_PLATFORM}${t.adapterId}:${t.message.id}`;
      await indexClient.set(s, e)
    }
  } catch (e) {
    console.error(C.ERRORS.INDEX, e)
  }
}, FIND_MESSAGE_BY_UNIVERSAL_ID = async e => {
  try {
    const t = C.INDEX_UNIVERSAL + e,
      s = await indexClient.hGetAll(t);
    return Object.keys(s).length > 0 ? s : null
  } catch (e) {
    return console.error(C.ERRORS.FIND, e), null
  }
}, FIND_ORIGINAL_MESSAGE = async (e, t) => {
  try {
    const s = `${C.INDEX_PLATFORM}${DISCORD_ID}:${e}`;
    let a = await indexClient.get(s);
    if (a) return await FIND_MESSAGE_BY_UNIVERSAL_ID(a);
    const r = await indexClient.lLen(C.HISTORY_KEY),
      i = Math.min(r, C.SEARCH_LIMIT);
    for (let s = 0; s < i; s++) {
      const a = await indexClient.lIndex(C.HISTORY_KEY, -1 - s);
      if (a) try {
        const s = JSON.parse(a);
        if (s.platform === C.PLATFORM && s.message?.id === e && (!t || !s.thread?.id || s.thread.id === t)) return s
      } catch (e) {
        continue
      }
    }
    return null
  } catch (e) {
    return console.error("Error finding original message:", e), null
  }
}, GET_MEDIA_INFO = e => {
  if (!e.attachments || 0 === e.attachments.size) return null;
  const t = e.attachments.first(),
    s = t.url,
    a = t.contentType || "";
  let r = C.MEDIA.DOCUMENT,
    i = path.extname(t.name || "") || "";
  return a.startsWith("image/") ? (r = a.includes("gif") ? C.MEDIA.GIF : C.MEDIA.IMAGE, i = i || ".jpg") : a.startsWith("video/") ? (r = C.MEDIA.VIDEO, i = i || ".mp4") : a.startsWith("audio/") && (r = C.MEDIA.AUDIO, i = i || ".mp3"), {
    url: s,
    type: r,
    mimeType: a,
    fileName: t.name || GENERATE_FILE_NAME(r, i),
    width: t.width || null,
    height: t.height || null,
    size: t.size || null
  }
}, HAS_THREAD_IN_RULES = (e, t) => {
  for (const s of ROUTING_RULES)
    for (const a of s.targets)
      if (a.adapterId === e && a.chatId === t && a.threadId) return !0;
  return !1
}, CREATE_BASE_MESSAGE = (e, t, s = {}) => {
  const a = e.channel?.id || e.channelId || "unknown",
    r = e.channel?.isThread?.() && HAS_THREAD_IN_RULES(DISCORD_ID, e.channel.parentId) ? e.channel.id : null,
    i = r ? e.channel.parentId : a;
  return {
    universalId: crypto.randomUUID(),
    timestamp: Date.now(),
    platform: C.PLATFORM,
    adapterId: DISCORD_ID,
    eventType: t,
    server: {
      id: e.guild?.id || null,
      name: e.guild?.name || null
    },
    conversation: {
      id: i,
      name: e.guild ? e.channel?.name || "Unknown" : "DM",
      type: e.guild ? "channel" : "dm"
    },
    thread: {
      id: r,
      name: r ? e.channel.name : null
    },
    author: {
      id: e.author?.id || s.userId || "system",
      username: e.author?.username || null,
      displayName: e.author?.displayName || e.author?.username || "Unknown",
      avatarUrl: e.author?.displayAvatarURL?.() || null,
      avatarPath: null,
      bot: e.author?.bot || !1
    },
    message: null,
    attachments: null,
    reaction: null,
    socialEvent: null,
    configChange: null,
    apiCall: s.apiCall || null,
    raw: e
  }
}, PROCESS_MESSAGE = async (e, t, s, a) => {
  if ([C.EVENTS.MESSAGE, C.EVENTS.EDIT, C.EVENTS.DELETE, C.EVENTS.PIN].includes(s)) {
    if (e.message = {
        id: t.id || a.messageId || "",
        text: a.newText || t.content || "",
        textFormatted: null,
        replyTo: null,
        edited: s === C.EVENTS.EDIT,
        pinned: s === C.EVENTS.PIN
      }, t.reference?.messageId) {
      const s = await FIND_ORIGINAL_MESSAGE(t.reference.messageId, t.channel.isThread?.() ? t.channel.id : null),
        a = t.reference.cached_message || await t.channel.messages.fetch(t.reference.messageId).catch((() => null));
      e.message.replyTo = {
        messageId: t.reference.messageId,
        universalId: s?.universalId || null,
        text: (a?.content || "").substring(0, C.TEXT_LIMIT),
        author: {
          id: s?.author?.id || a?.author?.id || "unknown",
          username: s?.author?.username || a?.author?.username || null,
          displayName: s?.author?.displayName || a?.author?.displayName || "Unknown",
          avatarUrl: s?.author?.avatarUrl || a?.author?.displayAvatarURL?.() || null
        }
      }
    }
  }
  const r = GET_MEDIA_INFO(t);
  if (r) try {
    const t = await DOWNLOAD_FILE(r.url, r.fileName);
    e.attachments = [{
      type: r.type,
      fileUrl: r.url,
      filePath: t,
      filename: r.fileName,
      mimeType: r.mimeType,
      size: r.size,
      width: r.width,
      height: r.height,
      duration: null,
      caption: null
    }]
  } catch (t) {
    console.error(`${C.ERRORS.DOWNLOAD} ${r.fileName}:`, t), e.attachments = [{
      type: r.type,
      fileUrl: r.url,
      filePath: null,
      filename: r.fileName,
      mimeType: r.mimeType,
      size: r.size,
      width: r.width,
      height: r.height,
      duration: null,
      caption: null
    }]
  } [C.EVENTS.JOIN, C.EVENTS.LEAVE, C.EVENTS.BAN].includes(s) && (e.socialEvent = {
    action: a.action || s,
    targetUser: {
      id: a.targetUserId || "unknown",
      username: a.targetUsername || null,
      displayName: a.targetDisplayName || "Unknown"
    },
    moderator: null,
    reason: a.reason || null,
    duration: null,
    role: null
  })
}, CREATE_UNIVERSAL_MESSAGE = async (e, t, s = {}) => {
  const a = CREATE_BASE_MESSAGE(e, t, s);
  return await PROCESS_MESSAGE(a, e, t, s), a
}, PUBLISH_EVENT = async (e, t, s = {}) => {
  try {
    const a = await CREATE_UNIVERSAL_MESSAGE(e, t, s);
    await publisherClient.publish(C.CHANNEL, JSON.stringify(a)), await indexClient.rPush(C.HISTORY_KEY, JSON.stringify(a)), a.message && await CREATE_MESSAGE_INDEX(a.universalId, a)
  } catch (e) {
    console.error(`${C.ERRORS.PROCESS} ${t} (${DISCORD_ID}):`, e)
  }
}, FIND_DISCORD_MESSAGE_BY_UNIVERSAL_ID = async (e, t, s) => {
  try {
    const a = C.INDEX_UNIVERSAL + e,
      r = await indexClient.hGetAll(a);
    if (0 === Object.keys(r).length) return null;
    if (r.platform === C.PLATFORM && r.adapterId === DISCORD_ID && r.chatId === t && (r.threadId || "") === (s || "") && r.messageId) return r.messageId;
    const i = await indexClient.lLen(C.HISTORY_KEY),
      n = Math.min(i, C.SEARCH_LIMIT);
    for (let a = 0; a < n; a++) {
      const r = await indexClient.lIndex(C.HISTORY_KEY, -1 - a);
      if (r) try {
        const a = JSON.parse(r);
        if (a.universalId === e && a.platform === C.PLATFORM && a.adapterId === DISCORD_ID && a.conversation.id === t && (a.thread?.id || "") === (s || "")) return a.message?.id
      } catch (e) {
        continue
      }
    }
    return null
  } catch (e) {
    return console.error("Error finding Discord message:", e), null
  }
}, SHOULD_SEND_MESSAGE = (e, t, s, a) => {
  const r = `${e.adapterId}:${e.conversation.id}${e.thread?.id?`/${e.thread.id}`:""}`,
    i = `${t}:${s}${a?`/${a}`:""}`;
  if (r === i) {
    if (e.isPluginResponse) return !0;
    return !1
  }
  for (const r of ROUTING_RULES) {
    if (r.isAll) {
      const i = r.targets.find((e => e.adapterId === t && e.chatId === s && (a ? e.threadId === a : null === e.threadId && !a) && ("in" === e.direction || "inout" === e.direction)));
      if (i) return !0
    } else {
      const i = r.targets.find((t => t.adapterId === e.adapterId && t.chatId === e.conversation.id && (e.thread?.id ? t.threadId === e.thread.id : null === t.threadId) && ("out" === t.direction || "inout" === t.direction)));
      if (i) {
        const e = r.targets.find((e => e.adapterId === t && e.chatId === s && (a ? e.threadId === a : null === e.threadId && !a) && ("in" === e.direction || "inout" === e.direction)));
        if (e) return !0
      }
    }
  }
  return !1
};
fs.existsSync(MEDIA_FOLDER) || fs.mkdirSync(MEDIA_FOLDER, {
  recursive: !0
});
const SEND_UNIVERSAL_MESSAGE_TO_DISCORD = async e => {
  try {
    if (e.apiCall) return;
    const t = [];
    for (const s of ROUTING_RULES)
      for (const a of s.targets) a.adapterId === DISCORD_ID && SHOULD_SEND_MESSAGE(e, a.adapterId, a.chatId, a.threadId) && t.push(a);
    for (const s of t) {
      const t = s.chatId,
        a = s.threadId;
      if (e.platform === C.PLATFORM && e.adapterId === DISCORD_ID && e.conversation.id === t && (e.thread?.id || null) === (a || null) && !e.isPluginResponse) continue;
      let r = null;
      if (e.message?.replyTo?.universalId && (r = await FIND_DISCORD_MESSAGE_BY_UNIVERSAL_ID(e.message.replyTo.universalId, t, a)), !e.isPluginResponse) {
        const t = e.platform.toUpperCase(),
          s = e.author.displayName || "Usuario Desconocido",
          a = e.conversation.name || "";
        e.message.text = `[${t}] ${s} (${a}):\n${e.message.text}`
      }
      try {
        const s = await client.channels.fetch(a || t);
        if (!s) continue;
        const i = {};
        if (r && (i.reply = {
            messageReference: r
          }), e.attachments && e.attachments.length > 0) {
          const a = e.attachments[0],
            r = e.message?.text || a.caption || "";
          if (a.filePath && fs.existsSync(a.filePath)) {
            const e = new AttachmentBuilder(a.filePath, {
              name: a.filename
            });
            i.files = [e], r && (i.content = r)
          } else i.content = `${C.MESSAGES.MEDIA_NOT_FOUND} ${a.filename}\n\n${r}`
        } else e.message?.text && (i.content = e.message.text);
        const n = await s.send(i);
        await CREATE_MESSAGE_INDEX(e.universalId, {
          universalId: e.universalId,
          platform: C.PLATFORM,
          adapterId: DISCORD_ID,
          message: {
            id: n.id
          },
          conversation: {
            id: t
          },
          thread: {
            id: a || null
          },
          author: {
            id: "system"
          },
          timestamp: Date.now()
        })
      } catch (e) {
        console.error(`[DISCORD] Error enviando a ${t}${a?`/${a}`:""}: ${e.message}`)
      }
    }
  } catch (e) {
    console.error(`Error procesando mensaje (${DISCORD_ID}):`, e)
  }
}, SETUP_GLOBAL_SUBSCRIBER = async e => {
  await e.subscribe(C.CHANNEL, (async (e, t) => {
    try {
      const t = JSON.parse(e);
      if (t.author?.bot === !0 && !t.isPluginResponse) return;
      await SEND_UNIVERSAL_MESSAGE_TO_DISCORD(t)
    } catch (e) {
      console.error(`${C.ERRORS.SUBSCRIBE}:`, e)
    }
  }))
}, SETUP_EVENT_HANDLERS = () => {
  client.on("messageCreate", (async e => {
    if (e.author.bot) return;
    await PUBLISH_EVENT(e, C.EVENTS.MESSAGE)
  })), client.on("messageUpdate", (async (e, t) => {
    if (t.author?.bot) return;
    await PUBLISH_EVENT(t, C.EVENTS.EDIT, {
      newText: t.content || ""
    })
  })), client.on("messageDelete", (async e => {
    await PUBLISH_EVENT(e, C.EVENTS.DELETE, {
      messageId: e.id
    })
  })), client.on("guildMemberAdd", (async e => {
    await PUBLISH_EVENT({
      guild: e.guild,
      author: e.user,
      channel: {
        id: "system"
      }
    }, C.EVENTS.JOIN, {
      text: `Nuevo miembro: ${e.user.username}`,
      action: C.EVENTS.JOIN,
      targetUserId: e.user.id,
      targetUsername: e.user.username,
      targetDisplayName: e.displayName || e.user.username,
      reason: "joined"
    })
  })), client.on("guildMemberRemove", (async e => {
    await PUBLISH_EVENT({
      guild: e.guild,
      author: e.user,
      channel: {
        id: "system"
      }
    }, C.EVENTS.LEAVE, {
      text: `Miembro salio: ${e.user.username}`,
      action: C.EVENTS.LEAVE,
      targetUserId: e.user.id,
      targetUsername: e.user.username,
      targetDisplayName: e.displayName || e.user.username,
      reason: "left"
    })
  })), client.on("guildBanAdd", (async e => {
    await PUBLISH_EVENT({
      guild: e.guild,
      author: e.user,
      channel: {
        id: "system"
      }
    }, C.EVENTS.BAN, {
      text: `Usuario baneado: ${e.user.username}`,
      action: C.EVENTS.BAN,
      targetUserId: e.user.id,
      targetUsername: e.user.username,
      targetDisplayName: e.user.username,
      reason: e.reason || "unknown"
    })
  })), client.on("error", (e => {
    console.error(`Bot error (${client.user?.tag}):`, e), PUBLISH_EVENT({
      error: e.message,
      channel: {
        id: "system"
      }
    }, C.EVENTS.API, {
      text: `Bot error: ${e.message}`,
      apiCall: {
        command: "error"
      }
    })
  }))
}, MAIN = async () => {
  await INIT_CLIENTS(), process.on("SIGINT", (async () => {
    client.destroy(), await publisherClient.quit(), await indexClient.quit(), await subscriberClient.quit(), process.exit(0)
  })), console.log(`Ejecutando ${DISCORD_ID}`)
};
MAIN().catch(console.error);
