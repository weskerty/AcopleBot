import TelegramBot from 'node-telegram-bot-api';
import BaseAdapter from '../core/BaseAdapter.js';
import path from 'path';
import fs from 'fs';

const ENV = process.env;
const TELEGRAM_TOKEN = ENV.TELEGRAM_T1;
const TELEGRAM_ID = 'telegram-1';

class TelegramAdapter extends BaseAdapter {
  constructor() {
    super({
      adapterId: TELEGRAM_ID,
      platform: 'telegram',
      token: TELEGRAM_TOKEN
    });
    this.bot = null;
    this.botInfo = null;
  }

  async init() {
    await this.initClients();

    try {
      this.bot = new TelegramBot(this.token, { polling: true });
      this.botInfo = await this.bot.getMe();
      console.log(`Bot ${this.botInfo.username} (${this.adapterId}) inicializado`);
      
      this.setupEventHandlers();
      
      await this.publishEvent({ botId: this.botInfo.id }, this.C.EVENTS.API, {
        text: `${this.botInfo.username} conectado`,
        apiCall: { command: 'bot_ready' }
      });
    } catch (e) {
      console.error(`Error inicializando bot ${this.adapterId}:`, e);
      process.exit(1);
    }

    process.on('SIGINT', async () => {
      await this.bot.close();
      await this.cleanup();
    });
    process.on('SIGTERM', async () => {
      await this.bot.close();
      await this.cleanup();
    });

    console.log(`Ejecutando ${this.adapterId}`);
  }

  getMediaInfo(msg) {
    const types = [
      { key: 'photo', type: this.C.MEDIA.IMAGE, mime: 'image/jpeg', ext: '.jpg', getFile: p => p[p.length - 1] },
      { key: 'video', type: this.C.MEDIA.VIDEO, mime: 'video/mp4', ext: '.mp4' },
      { key: 'video_note', type: this.C.MEDIA.VIDEO_NOTE, mime: 'video/mp4', ext: '.mp4' },
      { key: 'document', type: this.C.MEDIA.DOCUMENT, mime: 'application/octet-stream', ext: '', getFile: d => d },
      { key: 'audio', type: this.C.MEDIA.AUDIO, mime: 'audio/mpeg', ext: '.mp3' },
      { key: 'voice', type: this.C.MEDIA.VOICE, mime: 'audio/ogg', ext: '.ogg' },
      { key: 'sticker', type: this.C.MEDIA.STICKER, mime: 'image/webp', ext: '.webp' },
      { key: 'animation', type: this.C.MEDIA.GIF, mime: 'video/mp4', ext: '.mp4' }
    ];

    for (const t of types) {
      if (msg[t.key]) {
        const file = t.getFile ? t.getFile(msg[t.key]) : msg[t.key];
        const ext = t.key === 'document' && file.file_name ? path.extname(file.file_name) : t.ext;
        return {
          fileId: file.file_id,
          type: t.type,
          mimeType: file.mime_type || t.mime,
          fileName: file.file_name || this.genFileName(t.type, ext),
          width: file.width || null,
          height: file.height || null,
          duration: file.duration || null
        };
      }
    }
    return null;
  }

  async downloadTelegramFile(fileId, fileName) {
    try {
      const file = await this.bot.getFile(fileId);
      const url = `https://api.telegram.org/file/bot${this.token}/${file.file_path}`;
      return await this.downloadFile(url, fileName);
    } catch (e) {
      console.error('Error downloading file:', e);
      throw e;
    }
  }

  async createUniversalMessage(event, eventType, extra = {}) {
    const raw = event.message || event.edited_message || event.channel_post || event.edited_channel_post || event;
    const chatId = raw.chat ? raw.chat.id.toString() : event.chat_id || 'unknown';
    const threadId = raw.message_thread_id && this.hasThreadInRules(chatId) 
      ? raw.message_thread_id.toString() 
      : null;

    this.currentChatId = chatId;

    const msg = this.createBaseMessage(event, eventType, {
      server: { id: null, name: null },
      conversation: {
        id: chatId,
        name: raw.chat && (raw.chat.title || raw.chat.first_name || raw.chat.username) || 'Unknown',
        type: raw.chat ? (raw.chat.type === 'private' ? 'dm' : raw.chat.type) : 'unknown'
      },
      thread: { id: threadId, name: null },
      author: {
        id: raw.from ? raw.from.id.toString() : event.user_id || 'system',
        username: raw.from?.username || null,
        displayName: raw.from 
          ? `${raw.from.first_name || ''} ${raw.from.last_name || ''}`.trim() || 'Unknown' 
          : 'System',
        avatarUrl: null,
        avatarPath: null,
        bot: raw.from?.is_bot || false
      },
      apiCall: extra.apiCall || null
    });

    if ([this.C.EVENTS.MESSAGE, this.C.EVENTS.EDIT, this.C.EVENTS.DELETE, this.C.EVENTS.PIN].includes(eventType)) {
      msg.message = {
        id: raw.message_id ? raw.message_id.toString() : extra.message_id || '',
        text: raw.text || raw.caption || extra.text || '',
        textFormatted: null,
        replyTo: null,
        edited: eventType === this.C.EVENTS.EDIT,
        pinned: eventType === this.C.EVENTS.PIN
      };

      if (raw.reply_to_message) {
        const origMsg = await this.findOriginalMessage(
          raw.reply_to_message.message_id.toString(),
          raw.message_thread_id ? raw.message_thread_id.toString() : null
        );
        msg.message.replyTo = {
          messageId: raw.reply_to_message.message_id.toString(),
          universalId: origMsg?.universalId || null,
          text: (raw.reply_to_message.text || raw.reply_to_message.caption || '').substring(0, this.C.TEXT_LIMIT),
          author: {
            id: origMsg?.author?.id || raw.reply_to_message.from?.id?.toString(),
            username: origMsg?.author?.username || raw.reply_to_message.from?.username,
            displayName: origMsg?.author?.displayName || (raw.reply_to_message.from 
              ? `${raw.reply_to_message.from.first_name || ''} ${raw.reply_to_message.from.last_name || ''}`.trim() 
              : 'Unknown'),
            avatarUrl: origMsg?.author?.avatarUrl || null
          }
        };
      }

      if (extra.newText) msg.message.text = extra.newText;
    }

    const media = this.getMediaInfo(raw);
    if (media) {
      try {
        const filePath = await this.downloadTelegramFile(media.fileId, media.fileName);
        msg.attachments = [{
          type: media.type,
          fileUrl: null,
          filePath,
          filename: media.fileName,
          mimeType: media.mimeType,
          size: null,
          width: media.width,
          height: media.height,
          duration: media.duration,
          caption: raw.caption || null
        }];
      } catch (e) {
        console.error(`Error downloading ${media.fileName}:`, e);
        msg.attachments = [{
          type: media.type,
          fileUrl: null,
          filePath: null,
          filename: media.fileName,
          mimeType: media.mimeType,
          size: null,
          width: media.width,
          height: media.height,
          duration: media.duration,
          caption: raw.caption || null
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
      if (apiCall.api === 'node-telegram-bot-api') {
        const parts = apiCall.method.split('.');
        let target = this.bot;
        
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
      console.error('[TELEGRAM] Error executing API call:', e.message);
    }
  }

  async sendMessage(chatId, threadId, text, attachments, replyTo, apiCall) {
    try {
      this.currentChatId = chatId;

      if (apiCall) {
        await this.executeApiCall(apiCall);
        return null;
      }

      const opts = {};
      if (threadId) opts.message_thread_id = parseInt(threadId);
      if (replyTo) opts.reply_to_message_id = parseInt(replyTo);

      let sent = null;

      if (attachments && attachments.length > 0) {
        const att = attachments[0];
        const caption = text || att.caption || '';

        if (att.filePath && fs.existsSync(att.filePath)) {
          const methods = {
            [this.C.MEDIA.IMAGE]: (c, f, o) => this.bot.sendPhoto(c, f, o),
            [this.C.MEDIA.VIDEO]: (c, f, o) => this.bot.sendVideo(c, f, o),
            [this.C.MEDIA.VIDEO_NOTE]: (c, f, o) => this.bot.sendVideoNote(c, f, o),
            [this.C.MEDIA.AUDIO]: (c, f, o) => this.bot.sendAudio(c, f, o),
            [this.C.MEDIA.VOICE]: (c, f, o) => this.bot.sendVoice(c, f, o),
            [this.C.MEDIA.DOCUMENT]: (c, f, o) => this.bot.sendDocument(c, f, o),
            [this.C.MEDIA.STICKER]: (c, f, o) => this.bot.sendSticker(c, f, o),
            [this.C.MEDIA.GIF]: (c, f, o) => this.bot.sendAnimation(c, f, o)
          };

          const sendMethod = methods[att.type];
          if (sendMethod) {
            if (att.type === this.C.MEDIA.VIDEO_NOTE || att.type === this.C.MEDIA.STICKER) {
              sent = await sendMethod(chatId, att.filePath, opts);
              if (caption) await this.bot.sendMessage(chatId, caption, opts);
            } else {
              sent = await sendMethod(chatId, att.filePath, { ...opts, caption });
            }
          }
        } else {
          sent = await this.bot.sendMessage(chatId, `Media no encontrada: ${att.filename}\n\n${caption}`, opts);
        }
      } else if (text) {
        sent = await this.bot.sendMessage(chatId, text, opts);
      }

      return sent ? { messageId: sent.message_id.toString() } : null;
    } catch (e) {
      console.error(`[TELEGRAM] Error enviando mensaje:`, e.message);
      return null;
    }
  }

  setupEventHandlers() {
    this.bot.on('message', e => this.publishEvent(e, this.C.EVENTS.MESSAGE));
    
    this.bot.on('edited_message', e => 
      this.publishEvent(e, this.C.EVENTS.EDIT, { newText: e.text || e.caption || '' })
    );
    
    this.bot.on('channel_post', e => this.publishEvent(e, this.C.EVENTS.MESSAGE));
    
    this.bot.on('edited_channel_post', e => 
      this.publishEvent(e, this.C.EVENTS.EDIT, { newText: e.text || e.caption || '' })
    );

    [
      ['inline_query', e => ({ text: `Inline query: ${e.query}`, apiCall: { command: 'inline_query' } })],
      ['chosen_inline_result', e => ({ text: `Chosen inline: ${e.result_id}`, apiCall: { command: 'chosen_inline_result' } })],
      ['callback_query', e => ({ text: `Callback query: ${e.data || ''}`, apiCall: { command: 'callback_query' } })],
      ['shipping_query', e => ({ text: `Shipping query: ${e.id}`, apiCall: { command: 'shipping_query' } })],
      ['pre_checkout_query', e => ({ text: `Pre checkout: ${e.total_amount}`, apiCall: { command: 'pre_checkout_query' } })],
      ['poll', e => ({ text: `Poll: ${e.question}`, apiCall: { command: 'poll' } })],
      ['poll_answer', e => ({ text: `Poll answer: ${e.option_ids}`, apiCall: { command: 'poll_answer' } })]
    ].forEach(([ev, fn]) => {
      this.bot.on(ev, e => this.publishEvent(e, this.C.EVENTS.API, fn(e)));
    });

    this.bot.on('new_chat_members', e => {
      e.new_chat_members.forEach(u => {
        this.publishEvent(e, this.C.EVENTS.JOIN, {
          text: `Nuevo miembro: ${u.first_name || u.username}`,
          action: this.C.EVENTS.JOIN,
          targetUserId: u.id.toString(),
          targetUsername: u.username,
          targetDisplayName: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
          reason: 'joined'
        });
      });
    });

    this.bot.on('left_chat_member', e => {
      const u = e.left_chat_member;
      this.publishEvent(e, this.C.EVENTS.LEAVE, {
        text: `Miembro salio: ${u.first_name || u.username}`,
        action: this.C.EVENTS.LEAVE,
        targetUserId: u.id.toString(),
        targetUsername: u.username,
        targetDisplayName: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
        reason: 'left'
      });
    });

    this.bot.on('error', e => {
      console.error(`Bot error (${this.botInfo.username}):`, e);
      this.publishEvent({ error: e.message }, this.C.EVENTS.API, {
        text: `Bot error: ${e.message}`,
        apiCall: { command: 'error' }
      });
    });

    this.bot.on('polling_error', e => {
      console.error(`Polling error (${this.botInfo.username}):`, e);
      this.publishEvent({ error: e.message }, this.C.EVENTS.API, {
        text: `Polling error: ${e.message}`,
        apiCall: { command: 'polling_error' }
      });
    });
  }
}

(async () => {
  const adapter = new TelegramAdapter();
  await adapter.init();
})().catch(console.error);