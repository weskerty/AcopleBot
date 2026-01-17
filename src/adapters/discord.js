import { Client, GatewayIntentBits, Partials, AttachmentBuilder } from 'discord.js';
import BaseAdapter from '../core/BaseAdapter.js';
import path from 'path';
import fs from 'fs';

const ENV = process.env;
const DISCORD_TOKEN = ENV.DISCORD_T1;
const DISCORD_ID = 'discord-1';

class DiscordAdapter extends BaseAdapter {
  constructor() {
    super({
      adapterId: DISCORD_ID,
      platform: 'discord',
      token: DISCORD_TOKEN
    });
    this.client = null;
  }

  async init() {
    await this.initClients();

    try {
      this.client = new Client({
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

      this.client.once('ready', () => {
        console.log(`Bot ${this.client.user.tag} (${this.adapterId}) inicializado`);
        this.publishEvent({ botId: this.client.user.id }, this.C.EVENTS.API, {
          text: `${this.client.user.tag} conectado`,
          apiCall: { command: 'bot_ready' }
        });
      });

      this.setupEventHandlers();
      await this.client.login(this.token);
    } catch (e) {
      console.error(`Error inicializando bot ${this.adapterId}:`, e);
      process.exit(1);
    }

    process.on('SIGINT', async () => {
      this.client.destroy();
      await this.cleanup();
    });
    process.on('SIGTERM', async () => {
      this.client.destroy();
      await this.cleanup();
    });

    console.log(`Ejecutando ${this.adapterId}`);
  }

  getMediaInfo(msg) {
    if (!msg.attachments || msg.attachments.size === 0) return null;

    const att = msg.attachments.first();
    const url = att.url;
    const contentType = att.contentType || '';
    let type = this.C.MEDIA.DOCUMENT;
    let ext = path.extname(att.name || '') || '';

    if (contentType.startsWith('image/')) {
      type = contentType.includes('gif') ? this.C.MEDIA.GIF : this.C.MEDIA.IMAGE;
      ext = ext || '.jpg';
    } else if (contentType.startsWith('video/')) {
      type = this.C.MEDIA.VIDEO;
      ext = ext || '.mp4';
    } else if (contentType.startsWith('audio/')) {
      type = this.C.MEDIA.AUDIO;
      ext = ext || '.mp3';
    }

    return {
      url,
      type,
      mimeType: contentType,
      fileName: att.name || this.genFileName(type, ext),
      width: att.width || null,
      height: att.height || null,
      size: att.size || null
    };
  }

  async createUniversalMessage(event, eventType, extra = {}) {
    const chatId = event.channel?.id || event.channelId || 'unknown';
    const threadId = event.channel?.isThread?.() && this.hasThreadInRules(event.channel.parentId)
      ? event.channel.id
      : null;
    const conversationId = threadId ? event.channel.parentId : chatId;

    this.currentChatId = conversationId;

    const msg = this.createBaseMessage(event, eventType, {
      server: {
        id: event.guild?.id || null,
        name: event.guild?.name || null
      },
      conversation: {
        id: conversationId,
        name: event.guild ? event.channel?.name || 'Unknown' : 'DM',
        type: event.guild ? 'channel' : 'dm'
      },
      thread: {
        id: threadId,
        name: threadId ? event.channel.name : null
      },
      author: {
        id: event.author?.id || extra.userId || 'system',
        username: event.author?.username || null,
        displayName: event.author?.displayName || event.author?.username || 'Unknown',
        avatarUrl: event.author?.displayAvatarURL?.() || null,
        avatarPath: null,
        bot: event.author?.bot || false
      },
      apiCall: extra.apiCall || null
    });

    if ([this.C.EVENTS.MESSAGE, this.C.EVENTS.EDIT, this.C.EVENTS.DELETE, this.C.EVENTS.PIN].includes(eventType)) {
      msg.message = {
        id: event.id || extra.messageId || '',
        text: extra.newText || event.content || '',
        textFormatted: null,
        replyTo: null,
        edited: eventType === this.C.EVENTS.EDIT,
        pinned: eventType === this.C.EVENTS.PIN
      };

      if (event.reference?.messageId) {
        const origMsg = await this.findOriginalMessage(
          event.reference.messageId,
          event.channel.isThread?.() ? event.channel.id : null
        );
        const cachedMsg = event.reference.cached_message || 
          await event.channel.messages.fetch(event.reference.messageId).catch(() => null);

        msg.message.replyTo = {
          messageId: event.reference.messageId,
          universalId: origMsg?.universalId || null,
          text: (cachedMsg?.content || '').substring(0, this.C.TEXT_LIMIT),
          author: {
            id: origMsg?.author?.id || cachedMsg?.author?.id || 'unknown',
            username: origMsg?.author?.username || cachedMsg?.author?.username || null,
            displayName: origMsg?.author?.displayName || cachedMsg?.author?.displayName || 'Unknown',
            avatarUrl: origMsg?.author?.avatarUrl || cachedMsg?.author?.displayAvatarURL?.() || null
          }
        };
      }
    }

    const media = this.getMediaInfo(event);
    if (media) {
      try {
        const filePath = await this.downloadFile(media.url, media.fileName);
        msg.attachments = [{
          type: media.type,
          fileUrl: media.url,
          filePath,
          filename: media.fileName,
          mimeType: media.mimeType,
          size: media.size,
          width: media.width,
          height: media.height,
          duration: null,
          caption: null
        }];
      } catch (e) {
        console.error(`Error downloading ${media.fileName}:`, e);
        msg.attachments = [{
          type: media.type,
          fileUrl: media.url,
          filePath: null,
          filename: media.fileName,
          mimeType: media.mimeType,
          size: media.size,
          width: media.width,
          height: media.height,
          duration: null,
          caption: null
        }];
      }
    }

    if ([this.C.EVENTS.JOIN, this.C.EVENTS.LEAVE, this.C.EVENTS.BAN].includes(eventType)) {
      msg.socialEvent = {
        action: extra.action || eventType,
        targetUser: {
          id: extra.targetUserId || 'unknown',
          username: extra.targetUsername || null,
          displayName: extra.targetDisplayName || 'Unknown'
        },
        moderator: null,
        reason: extra.reason || null,
        duration: null,
        role: null
      };
    }

    return msg;
  }

  async executeApiCall(apiCall) {
    try {
      if (apiCall.api === 'discord.js') {
        const parts = apiCall.method.split('.');
        let target = this.client;
        
        for (let i = 0; i < parts.length - 1; i++) {
          target = target[parts[i]];
          if (!target) {
            throw new Error(`Property ${parts[i]} not found`);
          }
        }
        
        const method = parts[parts.length - 1];
        const fn = target[method];
        
        if (typeof fn === 'function') {
          return await fn.apply(target, apiCall.args || []);
        } else {
          throw new Error(`Method ${method} is not a function`);
        }
      }
    } catch (e) {
      console.error('[DISCORD] Error executing API call:', e.message);
    }
  }

  async sendMessage(chatId, threadId, text, attachments, replyTo, apiCall) {
    try {
      this.currentChatId = chatId;

      if (apiCall) {
        await this.executeApiCall(apiCall);
        return null;
      }

      const channel = await this.client.channels.fetch(threadId || chatId);
      if (!channel) return null;

      const opts = {};
      
      if (replyTo) {
        opts.reply = {
          messageReference: replyTo,
          failIfNotExists: false
        };
      }

      if (attachments && attachments.length > 0) {
        const att = attachments[0];
        const caption = text || att.caption || '';

        if (att.filePath && fs.existsSync(att.filePath)) {
          const attachment = new AttachmentBuilder(att.filePath, { name: att.filename });
          opts.files = [attachment];
          if (caption) opts.content = caption;
        } else {
          opts.content = `Media no encontrada: ${att.filename}\n\n${caption}`;
        }
      } else if (text) {
        opts.content = text;
      }

      const sent = await channel.send(opts);
      return sent ? { messageId: sent.id } : null;
    } catch (e) {
      console.error(`[DISCORD] Error enviando mensaje:`, e.message);
      return null;
    }
  }

  setupEventHandlers() {
    this.client.on('messageCreate', async (msg) => {
      if (msg.author.bot) return;
      await this.publishEvent(msg, this.C.EVENTS.MESSAGE);
    });

    this.client.on('messageUpdate', async (oldMsg, newMsg) => {
      if (newMsg.author?.bot) return;
      await this.publishEvent(newMsg, this.C.EVENTS.EDIT, {
        newText: newMsg.content || ''
      });
    });

    this.client.on('messageDelete', async (msg) => {
      await this.publishEvent(msg, this.C.EVENTS.DELETE, {
        messageId: msg.id
      });
    });

    this.client.on('guildMemberAdd', async (member) => {
      await this.publishEvent({
        guild: member.guild,
        author: member.user,
        channel: { id: 'system' }
      }, this.C.EVENTS.JOIN, {
        text: `Nuevo miembro: ${member.user.username}`,
        action: this.C.EVENTS.JOIN,
        targetUserId: member.user.id,
        targetUsername: member.user.username,
        targetDisplayName: member.displayName || member.user.username,
        reason: 'joined'
      });
    });

    this.client.on('guildMemberRemove', async (member) => {
      await this.publishEvent({
        guild: member.guild,
        author: member.user,
        channel: { id: 'system' }
      }, this.C.EVENTS.LEAVE, {
        text: `Miembro salio: ${member.user.username}`,
        action: this.C.EVENTS.LEAVE,
        targetUserId: member.user.id,
        targetUsername: member.user.username,
        targetDisplayName: member.displayName || member.user.username,
        reason: 'left'
      });
    });

    this.client.on('guildBanAdd', async (ban) => {
      await this.publishEvent({
        guild: ban.guild,
        author: ban.user,
        channel: { id: 'system' }
      }, this.C.EVENTS.BAN, {
        text: `Usuario baneado: ${ban.user.username}`,
        action: this.C.EVENTS.BAN,
        targetUserId: ban.user.id,
        targetUsername: ban.user.username,
        targetDisplayName: ban.user.username,
        reason: ban.reason || 'unknown'
      });
    });

    this.client.on('error', (error) => {
      console.error(`Bot error (${this.client.user?.tag}):`, error);
      this.publishEvent({
        error: error.message,
        channel: { id: 'system' }
      }, this.C.EVENTS.API, {
        text: `Bot error: ${error.message}`,
        apiCall: { command: 'error' }
      });
    });
  }
}

(async () => {
  const adapter = new DiscordAdapter();
  await adapter.init();
})().catch(console.error);