import { Client, GatewayIntentBits, Partials, AttachmentBuilder } from "discord.js";
import redis from "redis";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";

const ENV = process.env;
const DISCORD_TOKEN = ENV.DISCORD_T1;
const DISCORD_ID = "discord-1";

const LOAD_RULES = () => {
  const rules = [];
  let i = 1;
  while (ENV[`REGLA_${i}`]) {
    const ruleStr = ENV[`REGLA_${i}`];
    const rule = {
      ruleId: `REGLA_${i}`,
      targets: [],
      isAll: false
    };
    
    const parts = ruleStr.split(",");
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.startsWith("all:")) {
        rule.isAll = true;
        const [, adapterId, chatId, direction] = trimmed.split(":");
        rule.targets.push({
          adapterId: adapterId.trim(),
          chatId: chatId.trim(),
          direction: direction.trim()
        });
      } else {
        const segments = trimmed.split(":");
        if (segments.length >= 3) {
          const adapterId = segments[0].trim();
          const chatId = segments[1].trim();
          const direction = segments[2].trim();
          
          let channelId = chatId;
          let threadId = null;
          if (chatId.includes("/")) {
            [channelId, threadId] = chatId.split("/");
          }
          
          rule.targets.push({
            adapterId,
            chatId: channelId,
            threadId: threadId || null,
            direction
          });
        }
      }
    }
    rules.push(rule);
    i++;
  }
  return rules;
};

const ROUTING_RULES = LOAD_RULES();
const VALKEY_HOST = ENV.VALKEY_HOST;
const VALKEY_PORT = Number(ENV.VALKEY_PORT);
const MEDIA_FOLDER = ENV.MEDIA_FOLDER || "../media";

const C = {
  PLATFORM: "discord",
  CHANNEL: "bot.On.AdaptadorMessage",
  HISTORY_KEY: "history:global",
  INDEX_UNIVERSAL: "index:universal:",
  INDEX_PLATFORM: "index:platform:discord:",
  SEARCH_LIMIT: 1000,
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
};

const REDIS_CONFIG = {
  socket: {
    host: VALKEY_HOST,
    port: VALKEY_PORT
  }
};

let client;
let publisherClient;
let indexClient;
let subscriberClient;

const INIT_CLIENTS = async () => {
  if (!DISCORD_TOKEN) {
    console.error("No se encontro DISCORD_T1");
    process.exit(1);
  }

  publisherClient = redis.createClient(REDIS_CONFIG);
  indexClient = redis.createClient(REDIS_CONFIG);
  subscriberClient = redis.createClient(REDIS_CONFIG);

  [publisherClient, indexClient, subscriberClient].forEach(c => {
    c.on("error", err => console.error(C.ERRORS.REDIS, err));
  });

  try {
    await Promise.all([
      publisherClient.connect(),
      indexClient.connect(),
      subscriberClient.connect()
    ]);
    console.log(C.MESSAGES.CONNECTED);
    await SETUP_GLOBAL_SUBSCRIBER(subscriberClient);
  } catch (err) {
    console.error(C.MESSAGES.CONNECTION_ERROR, err);
    process.exit(1);
  }

  try {
    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions
      ],
      partials: [Partials.Channel, Partials.Message, Partials.Reaction]
    });

    client.once("ready", () => {
      console.log(`Bot ${client.user.tag} (${DISCORD_ID}) inicializado`);
      PUBLISH_EVENT(
        { botId: client.user.id },
        C.EVENTS.API,
        { text: `${client.user.tag} conectado`, apiCall: { command: "bot_ready" } }
      );
    });

    SETUP_EVENT_HANDLERS();
    await client.login(DISCORD_TOKEN);
  } catch (err) {
    console.error(`Error inicializando bot ${DISCORD_ID}:`, err);
    process.exit(1);
  }
};

const GENERATE_FILE_NAME = (type, ext) =>
  `${type}_${Date.now()}_${crypto.randomUUID().substring(0, C.UUID_LENGTH)}${ext}`;

const DOWNLOAD_FILE = async (url, fileName) => {
  try {
    const filePath = path.join(MEDIA_FOLDER, fileName);
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(filePath);
      const protocol = url.startsWith("https") ? https : http;
      
      protocol.get(url, response => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return DOWNLOAD_FILE(response.headers.location, fileName).then(resolve).catch(reject);
        }
        if (response.statusCode === 200) {
          response.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve(filePath);
          });
          file.on("error", reject);
        } else {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        }
      }).on("error", err => {
        fs.unlink(filePath, () => {});
        reject(err);
      });
    });
  } catch (err) {
    console.error(C.ERRORS.DOWNLOAD, err);
    throw err;
  }
};

const CREATE_MESSAGE_INDEX = async (universalId, msg) => {
  try {
    const key = C.INDEX_UNIVERSAL + universalId;
    await indexClient.hSet(key, {
      universalId,
      platform: msg.platform,
      adapterId: msg.adapterId,
      messageId: msg.message?.id || "",
      chatId: msg.conversation.id,
      threadId: msg.thread?.id || "",
      authorId: msg.author.id,
      timestamp: msg.timestamp.toString(),
      text: msg.message?.text || ""
    });

    if (msg.message?.id) {
      const platformKey = `${C.INDEX_PLATFORM}${msg.adapterId}:${msg.message.id}`;
      await indexClient.set(platformKey, universalId);
    }
  } catch (err) {
    console.error(C.ERRORS.INDEX, err);
  }
};

const FIND_MESSAGE_BY_UNIVERSAL_ID = async (universalId) => {
  try {
    const key = C.INDEX_UNIVERSAL + universalId;
    const data = await indexClient.hGetAll(key);
    return Object.keys(data).length > 0 ? data : null;
  } catch (err) {
    console.error(C.ERRORS.FIND, err);
    return null;
  }
};

const FIND_ORIGINAL_MESSAGE = async (messageId, threadId) => {
  try {
    const platformKey = `${C.INDEX_PLATFORM}${DISCORD_ID}:${messageId}`;
    let universalId = await indexClient.get(platformKey);
    
    if (universalId) {
      return await FIND_MESSAGE_BY_UNIVERSAL_ID(universalId);
    }

    const historyLen = await indexClient.lLen(C.HISTORY_KEY);
    const limit = Math.min(historyLen, C.SEARCH_LIMIT);
    
    for (let i = 0; i < limit; i++) {
      const item = await indexClient.lIndex(C.HISTORY_KEY, -1 - i);
      if (item) {
        try {
          const msg = JSON.parse(item);
          if (
            msg.platform === C.PLATFORM &&
            msg.message?.id === messageId &&
            (!threadId || !msg.thread?.id || msg.thread.id === threadId)
          ) {
            return msg;
          }
        } catch (e) {
          continue;
        }
      }
    }
    return null;
  } catch (err) {
    console.error("Error finding original message:", err);
    return null;
  }
};

const GET_MEDIA_INFO = (message) => {
  if (!message.attachments || message.attachments.size === 0) return null;
  
  const attachment = message.attachments.first();
  const url = attachment.url;
  const contentType = attachment.contentType || "";
  
  let type = C.MEDIA.DOCUMENT;
  let ext = path.extname(attachment.name || "") || "";
  
  if (contentType.startsWith("image/")) {
    type = contentType.includes("gif") ? C.MEDIA.GIF : C.MEDIA.IMAGE;
    ext = ext || ".jpg";
  } else if (contentType.startsWith("video/")) {
    type = C.MEDIA.VIDEO;
    ext = ext || ".mp4";
  } else if (contentType.startsWith("audio/")) {
    type = C.MEDIA.AUDIO;
    ext = ext || ".mp3";
  }
  
  return {
    url,
    type,
    mimeType: contentType,
    fileName: attachment.name || GENERATE_FILE_NAME(type, ext),
    width: attachment.width || null,
    height: attachment.height || null,
    size: attachment.size || null
  };
};

const HAS_THREAD_IN_RULES = (adapterId, chatId) => {
  for (const rule of ROUTING_RULES) {
    for (const target of rule.targets) {
      if (target.adapterId === adapterId && target.chatId === chatId && target.threadId) {
        return true;
      }
    }
  }
  return false;
};

const CREATE_BASE_MESSAGE = (message, eventType, extra = {}) => {
  const channelId = message.channel?.id || message.channelId || "unknown";
  const threadId = message.channel?.isThread?.() && HAS_THREAD_IN_RULES(DISCORD_ID, message.channel.parentId)
    ? message.channel.id
    : null;
  
  const conversationId = threadId ? message.channel.parentId : channelId;
  
  return {
    universalId: crypto.randomUUID(),
    timestamp: Date.now(),
    platform: C.PLATFORM,
    adapterId: DISCORD_ID,
    eventType,
    server: {
      id: message.guild?.id || null,
      name: message.guild?.name || null
    },
    conversation: {
      id: conversationId,
      name: message.guild ? message.channel?.name || "Unknown" : "DM",
      type: message.guild ? "channel" : "dm"
    },
    thread: {
      id: threadId,
      name: threadId ? message.channel.name : null
    },
    author: {
      id: message.author?.id || extra.userId || "system",
      username: message.author?.username || null,
      displayName: message.author?.displayName || message.author?.username || "Unknown",
      avatarUrl: message.author?.displayAvatarURL?.() || null,
      avatarPath: null,
      bot: message.author?.bot || false
    },
    message: null,
    attachments: null,
    reaction: null,
    socialEvent: null,
    configChange: null,
    apiCall: extra.apiCall || null,
    raw: message
  };
};

const PROCESS_MESSAGE = async (baseMsg, message, eventType, extra) => {
  if ([C.EVENTS.MESSAGE, C.EVENTS.EDIT, C.EVENTS.DELETE, C.EVENTS.PIN].includes(eventType)) {
    baseMsg.message = {
      id: message.id || extra.messageId || "",
      text: extra.newText || message.content || "",
      textFormatted: null,
      replyTo: null,
      edited: eventType === C.EVENTS.EDIT,
      pinned: eventType === C.EVENTS.PIN
    };

    if (message.reference?.messageId) {
      const originalMsg = await FIND_ORIGINAL_MESSAGE(
        message.reference.messageId,
        message.channel.isThread?.() ? message.channel.id : null
      );
      
      const referencedMessage = message.reference.cached_message || 
        await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
      
      baseMsg.message.replyTo = {
        messageId: message.reference.messageId,
        universalId: originalMsg?.universalId || null,
        text: (referencedMessage?.content || "").substring(0, C.TEXT_LIMIT),
        author: {
          id: originalMsg?.author?.id || referencedMessage?.author?.id || "unknown",
          username: originalMsg?.author?.username || referencedMessage?.author?.username || null,
          displayName: originalMsg?.author?.displayName || referencedMessage?.author?.displayName || "Unknown",
          avatarUrl: originalMsg?.author?.avatarUrl || referencedMessage?.author?.displayAvatarURL?.() || null
        }
      };
    }
  }

  const mediaInfo = GET_MEDIA_INFO(message);
  if (mediaInfo) {
    try {
      const filePath = await DOWNLOAD_FILE(mediaInfo.url, mediaInfo.fileName);
      baseMsg.attachments = [{
        type: mediaInfo.type,
        fileUrl: mediaInfo.url,
        filePath,
        filename: mediaInfo.fileName,
        mimeType: mediaInfo.mimeType,
        size: mediaInfo.size,
        width: mediaInfo.width,
        height: mediaInfo.height,
        duration: null,
        caption: null
      }];
    } catch (err) {
      console.error(`${C.ERRORS.DOWNLOAD} ${mediaInfo.fileName}:`, err);
      baseMsg.attachments = [{
        type: mediaInfo.type,
        fileUrl: mediaInfo.url,
        filePath: null,
        filename: mediaInfo.fileName,
        mimeType: mediaInfo.mimeType,
        size: mediaInfo.size,
        width: mediaInfo.width,
        height: mediaInfo.height,
        duration: null,
        caption: null
      }];
    }
  }

  if ([C.EVENTS.JOIN, C.EVENTS.LEAVE, C.EVENTS.BAN].includes(eventType)) {
    baseMsg.socialEvent = {
      action: extra.action || eventType,
      targetUser: {
        id: extra.targetUserId || "unknown",
        username: extra.targetUsername || null,
        displayName: extra.targetDisplayName || "Unknown"
      },
      moderator: null,
      reason: extra.reason || null,
      duration: null,
      role: null
    };
  }
};

const CREATE_UNIVERSAL_MESSAGE = async (message, eventType, extra = {}) => {
  const baseMsg = CREATE_BASE_MESSAGE(message, eventType, extra);
  await PROCESS_MESSAGE(baseMsg, message, eventType, extra);
  return baseMsg;
};

const PUBLISH_EVENT = async (message, eventType, extra = {}) => {
  try {
    const universalMsg = await CREATE_UNIVERSAL_MESSAGE(message, eventType, extra);
    await publisherClient.publish(C.CHANNEL, JSON.stringify(universalMsg));
    await indexClient.rPush(C.HISTORY_KEY, JSON.stringify(universalMsg));
    if (universalMsg.message) {
      await CREATE_MESSAGE_INDEX(universalMsg.universalId, universalMsg);
    }
  } catch (err) {
    console.error(`${C.ERRORS.PROCESS} ${eventType} (${DISCORD_ID}):`, err);
  }
};

const FIND_DISCORD_MESSAGE_BY_UNIVERSAL_ID = async (universalId, channelId, threadId) => {
  try {
    const key = C.INDEX_UNIVERSAL + universalId;
    const data = await indexClient.hGetAll(key);
    
    if (Object.keys(data).length === 0) return null;
    
    if (
      data.platform === C.PLATFORM &&
      data.adapterId === DISCORD_ID &&
      data.chatId === channelId &&
      (data.threadId || "") === (threadId || "") &&
      data.messageId
    ) {
      return data.messageId;
    }

    const historyLen = await indexClient.lLen(C.HISTORY_KEY);
    const limit = Math.min(historyLen, C.SEARCH_LIMIT);
    
    for (let i = 0; i < limit; i++) {
      const item = await indexClient.lIndex(C.HISTORY_KEY, -1 - i);
      if (item) {
        try {
          const msg = JSON.parse(item);
          if (
            msg.universalId === universalId &&
            msg.platform === C.PLATFORM &&
            msg.adapterId === DISCORD_ID &&
            msg.conversation.id === channelId &&
            (msg.thread?.id || "") === (threadId || "")
          ) {
            return msg.message?.id;
          }
        } catch (e) {
          continue;
        }
      }
    }
    return null;
  } catch (err) {
    console.error("Error finding Discord message:", err);
    return null;
  }
};

const SHOULD_SEND_MESSAGE = (sourceMsg, targetAdapterId, targetChatId, targetThreadId) => {
  const sourceId = `${sourceMsg.adapterId}:${sourceMsg.conversation.id}${sourceMsg.thread?.id ? `/${sourceMsg.thread.id}` : ""}`;
  const targetId = `${targetAdapterId}:${targetChatId}${targetThreadId ? `/${targetThreadId}` : ""}`;
  
  if (sourceId === targetId) return false;

  for (const rule of ROUTING_RULES) {
    if (rule.isAll) {
      const targetMatch = rule.targets.find(t =>
        t.adapterId === targetAdapterId &&
        t.chatId === targetChatId &&
        (targetThreadId ? t.threadId === targetThreadId : t.threadId === null && !targetThreadId) &&
        (t.direction === "in" || t.direction === "inout")
      );
      if (targetMatch) return true;
    } else {
      const sourceMatch = rule.targets.find(t =>
        t.adapterId === sourceMsg.adapterId &&
        t.chatId === sourceMsg.conversation.id &&
        (sourceMsg.thread?.id ? t.threadId === sourceMsg.thread.id : t.threadId === null) &&
        (t.direction === "out" || t.direction === "inout")
      );
      
      if (sourceMatch) {
        const targetMatch = rule.targets.find(t =>
          t.adapterId === targetAdapterId &&
          t.chatId === targetChatId &&
          (targetThreadId ? t.threadId === targetThreadId : t.threadId === null && !targetThreadId) &&
          (t.direction === "in" || t.direction === "inout")
        );
        if (targetMatch) return true;
      }
    }
  }
  return false;
};

if (!fs.existsSync(MEDIA_FOLDER)) {
  fs.mkdirSync(MEDIA_FOLDER, { recursive: true });
}

const SEND_UNIVERSAL_MESSAGE_TO_DISCORD = async (msg) => {
  try {
    if (msg.apiCall) return;

    const targets = [];
    for (const rule of ROUTING_RULES) {
      for (const target of rule.targets) {
        if (target.adapterId === DISCORD_ID && SHOULD_SEND_MESSAGE(msg, target.adapterId, target.chatId, target.threadId)) {
          targets.push(target);
        }
      }
    }

    for (const target of targets) {
      const channelId = target.chatId;
      const threadId = target.threadId;

      if (
        msg.platform === C.PLATFORM &&
        msg.adapterId === DISCORD_ID &&
        msg.conversation.id === channelId &&
        (msg.thread?.id || null) === (threadId || null)
      ) {
        continue;
      }

      let replyToId = null;
      if (msg.message?.replyTo?.universalId) {
        replyToId = await FIND_DISCORD_MESSAGE_BY_UNIVERSAL_ID(
          msg.message.replyTo.universalId,
          channelId,
          threadId
        );
      }

      const platform = msg.platform.toUpperCase();
      const author = msg.author.displayName || "Usuario Desconocido";
      const conversationName = msg.conversation.name || "";
      let text = msg.message?.text || "";
      text = `[${platform}] ${author} (${conversationName}):\n${text}`;

      try {
        const channel = await client.channels.fetch(threadId || channelId);
        if (!channel) continue;

        const messageOptions = {};
        if (replyToId) {
          messageOptions.reply = { messageReference: replyToId };
        }

        if (msg.attachments && msg.attachments.length > 0) {
          const attachment = msg.attachments[0];
          const caption = text || attachment.caption || "";
          
          if (attachment.filePath && fs.existsSync(attachment.filePath)) {
            const discordAttachment = new AttachmentBuilder(attachment.filePath, {
              name: attachment.filename
            });
            messageOptions.files = [discordAttachment];
            if (caption) {
              messageOptions.content = caption;
            }
          } else {
            messageOptions.content = `${C.MESSAGES.MEDIA_NOT_FOUND} ${attachment.filename}\n\n${caption}`;
          }
        } else if (text) {
          messageOptions.content = text;
        }

        const sentMessage = await channel.send(messageOptions);
        
        await CREATE_MESSAGE_INDEX(msg.universalId, {
          universalId: msg.universalId,
          platform: C.PLATFORM,
          adapterId: DISCORD_ID,
          message: { id: sentMessage.id },
          conversation: { id: channelId },
          thread: { id: threadId || null },
          author: { id: "system" },
          timestamp: Date.now()
        });
      } catch (err) {
        console.error(`[DISCORD] Error enviando a ${channelId}${threadId ? `/${threadId}` : ""}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`Error procesando mensaje (${DISCORD_ID}):`, err);
  }
};

const SETUP_GLOBAL_SUBSCRIBER = async (subClient) => {
  await subClient.subscribe(C.CHANNEL, async (message) => {
    try {
      const msg = JSON.parse(message);
      await SEND_UNIVERSAL_MESSAGE_TO_DISCORD(msg);
    } catch (err) {
      console.error(`${C.ERRORS.SUBSCRIBE}:`, err);
    }
  });
};

const SETUP_EVENT_HANDLERS = () => {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    await PUBLISH_EVENT(message, C.EVENTS.MESSAGE);
  });

  client.on("messageUpdate", async (oldMessage, newMessage) => {
    if (newMessage.author?.bot) return;
    await PUBLISH_EVENT(newMessage, C.EVENTS.EDIT, { newText: newMessage.content || "" });
  });

  client.on("messageDelete", async (message) => {
    await PUBLISH_EVENT(message, C.EVENTS.DELETE, { messageId: message.id });
  });

  client.on("guildMemberAdd", async (member) => {
    await PUBLISH_EVENT(
      { guild: member.guild, author: member.user, channel: { id: "system" } },
      C.EVENTS.JOIN,
      {
        text: `Nuevo miembro: ${member.user.username}`,
        action: C.EVENTS.JOIN,
        targetUserId: member.user.id,
        targetUsername: member.user.username,
        targetDisplayName: member.displayName || member.user.username,
        reason: "joined"
      }
    );
  });

  client.on("guildMemberRemove", async (member) => {
    await PUBLISH_EVENT(
      { guild: member.guild, author: member.user, channel: { id: "system" } },
      C.EVENTS.LEAVE,
      {
        text: `Miembro salio: ${member.user.username}`,
        action: C.EVENTS.LEAVE,
        targetUserId: member.user.id,
        targetUsername: member.user.username,
        targetDisplayName: member.displayName || member.user.username,
        reason: "left"
      }
    );
  });

  client.on("guildBanAdd", async (ban) => {
    await PUBLISH_EVENT(
      { guild: ban.guild, author: ban.user, channel: { id: "system" } },
      C.EVENTS.BAN,
      {
        text: `Usuario baneado: ${ban.user.username}`,
        action: C.EVENTS.BAN,
        targetUserId: ban.user.id,
        targetUsername: ban.user.username,
        targetDisplayName: ban.user.username,
        reason: ban.reason || "unknown"
      }
    );
  });

  client.on("error", (error) => {
    console.error(`Bot error (${client.user?.tag}):`, error);
    PUBLISH_EVENT(
      { error: error.message, channel: { id: "system" } },
      C.EVENTS.API,
      { text: `Bot error: ${error.message}`, apiCall: { command: "error" } }
    );
  });
};

const MAIN = async () => {
  await INIT_CLIENTS();

  process.on("SIGINT", async () => {
    client.destroy();
    await publisherClient.quit();
    await indexClient.quit();
    await subscriberClient.quit();
    process.exit(0);
  });

  console.log(`Ejecutando ${DISCORD_ID}`);
};

MAIN().catch(console.error);