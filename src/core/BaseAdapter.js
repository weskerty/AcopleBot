
import redis from 'redis';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { pipeline } from 'stream/promises';

const ENV = process.env;

export default class BaseAdapter {
  constructor(config) {
    this.cfg = config;
    this.adapterId = config.adapterId;
    this.platform = config.platform;
    this.token = config.token;
    
    this.VALKEY_HOST = ENV.VALKEY_HOST || 'localhost';
    this.VALKEY_PORT = Number(ENV.VALKEY_PORT || 6379);
    this.MEDIA_FOLDER = ENV.MEDIA_FOLDER || 'src/media';
    
    this.routingRules = this.loadRules();
    
    this.publisherClient = null;
    this.subscriberClient = null;
    this.indexClient = null;
    
    this.C = {
      CHANNEL: 'bot.On.AdaptadorMessage',
      TEXT_LIMIT: 100,
      UUID_LENGTH: 8,
      EVENTS: {
        MESSAGE: 'message',
        EDIT: 'edit',
        DELETE: 'delete',
        PIN: 'pin',
        JOIN: 'join',
        LEAVE: 'leave',
        BAN: 'ban',
        API: 'api',
        REACTION: 'reaction'
      },
      MEDIA: {
        IMAGE: 'image',
        VIDEO: 'video',
        AUDIO: 'audio',
        VOICE: 'voice',
        DOCUMENT: 'document',
        STICKER: 'sticker',
        GIF: 'gif',
        VIDEO_NOTE: 'video_note'
      }
    };
  }

  loadRules() {
    const rules = [];
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
          rule.targets.push({
            adapterId: aId.trim(),
            chatId: cId.trim(),
            direction: dir.trim()
          });
        } else {
          const seg = t.split(':');
          if (seg.length >= 3) {
            const aId = seg[0].trim();
            const cId = seg[1].trim();
            const dir = seg[2].trim();
            let chatId = cId, threadId = null;
            if (cId.includes('/')) [chatId, threadId] = cId.split('/');
            rule.targets.push({
              adapterId: aId,
              chatId,
              threadId: threadId || null,
              direction: dir
            });
          }
        }
      }
      rules.push(rule);
      i++;
    }
    return rules;
  }

  async initClients() {
    if (!this.token) {
      console.error(`No se encontró token para ${this.adapterId}`);
      process.exit(1);
    }

    const cfg = {
      socket: {
        host: this.VALKEY_HOST,
        port: this.VALKEY_PORT,
        reconnectStrategy: r => r > 10 ? new Error('Max retries') : Math.min(100 * r, 3000)
      }
    };

    this.publisherClient = redis.createClient(cfg);
    this.subscriberClient = redis.createClient(cfg);
    this.indexClient = redis.createClient(cfg);

    [this.publisherClient, this.subscriberClient, this.indexClient].forEach(c => {
      c.on('error', e => console.error('Redis Error:', e));
    });

    try {
      await Promise.all([
        this.publisherClient.connect(),
        this.subscriberClient.connect(),
        this.indexClient.connect()
      ]);
      console.log('✅ Conectado a Valkey exitosamente');
      await this.setupGlobalSubscriber();
    } catch (e) {
      console.error('Error conectando a Valkey:', e);
      process.exit(1);
    }

    fs.existsSync(this.MEDIA_FOLDER) || fs.mkdirSync(this.MEDIA_FOLDER, { recursive: true });
  }

  genFileName(type, ext) {
    return `${type}_${Date.now()}_${crypto.randomUUID().substring(0, this.C.UUID_LENGTH)}${ext}`;
  }

  async downloadFile(url, fileName) {
    try {
      const filePath = path.join(this.MEDIA_FOLDER, fileName);
      const writer = fs.createWriteStream(filePath);
      const proto = url.startsWith('https') ? https : http;

      return new Promise((res, rej) => {
        proto.get(url, async (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            writer.close();
            fs.unlinkSync(filePath);
            return this.downloadFile(response.headers.location, fileName).then(res).catch(rej);
          }

          if (response.statusCode === 200) {
            try {
              await pipeline(response, writer);
              res(filePath);
            } catch (e) {
              rej(e);
            }
          } else {
            writer.close();
            fs.unlinkSync(filePath);
            rej(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          }
        }).on('error', e => {
          writer.close();
          fs.unlink(filePath, () => {});
          rej(e);
        });
      });
    } catch (e) {
      console.error('Error downloading file:', e);
      throw e;
    }
  }

  async createMessageIndex(universalId, msgData) {
    try {
      const aId = msgData.adapterId;
      const cId = msgData.conversation.id;
      const pId = msgData.message?.id;
      const k = `msg:${aId}:${cId}`;
      
      const p = this.indexClient.multi();
      
      p.hSet(`${k}:u:${universalId}`, {d: JSON.stringify(msgData)});
      
      if (pId) {
        p.set(`${k}:p2u:${pId}`, universalId);
        p.set(`${k}:u2p:${universalId}`, pId);
      }
      
      p.set(`idx:u2loc:${universalId}`, `${aId}:${cId}`, {EX: 86400});
      
      await p.exec();
    } catch (e) {
      console.error('Error creating message index:', e);
    }
  }

  async findMessageByUniversalId(universalId) {
    try {
      const loc = await this.indexClient.get(`idx:u2loc:${universalId}`);
      if (!loc) return null;
      
      const [aId, cId] = loc.split(':');
      const data = await this.indexClient.hGet(`msg:${aId}:${cId}:u:${universalId}`, 'd');
      
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('Error finding message by universalId:', e);
      return null;
    }
  }

  async resolveReplyTo(universalId) {
    try {
      const loc = await this.indexClient.get(`idx:u2loc:${universalId}`);
      if (!loc) return null;
      
      const [srcAid, srcCid] = loc.split(':');
      const origData = await this.indexClient.hGet(`msg:${srcAid}:${srcCid}:u:${universalId}`, 'd');
      
      if (!origData) return null;
      
      const k = `msg:${this.adapterId}:${this.currentChatId}`;
      const myMsgId = await this.indexClient.get(`${k}:u2p:${universalId}`);
      
      return myMsgId;
    } catch (e) {
      console.error('Error resolving replyTo:', e);
      return null;
    }
  }

  async findOriginalMessage(messageId, threadId) {
    try {
      const chatId = this.currentChatId;
      const k = `msg:${this.adapterId}:${chatId}`;
      const universalId = await this.indexClient.get(`${k}:p2u:${messageId}`);

      if (universalId) {
        return await this.findMessageByUniversalId(universalId);
      }

      return null;
    } catch (e) {
      console.error('Error finding original message:', e);
      return null;
    }
  }

  hasThreadInRules(chatId) {
    for (const rule of this.routingRules) {
      for (const t of rule.targets) {
        if (t.adapterId === this.adapterId && t.chatId === chatId && t.threadId) {
          return true;
        }
      }
    }
    return false;
  }

  createBaseMessage(rawEvent, eventType, extra = {}) {
    return {
      universalId: crypto.randomUUID(),
      timestamp: Date.now(),
      platform: this.platform,
      adapterId: this.adapterId,
      eventType,
      server: extra.server || { id: null, name: null },
      conversation: extra.conversation || { id: 'unknown', name: 'Unknown', type: 'unknown' },
      thread: extra.thread || { id: null, name: null },
      author: extra.author || { id: 'system', username: null, displayName: 'System', avatarUrl: null, avatarPath: null, bot: false },
      message: null,
      attachments: null,
      reaction: null,
      socialEvent: null,
      configChange: null,
      apiCall: extra.apiCall || null,
      raw: rawEvent
    };
  }

  async publishEvent(event, eventType, extra = {}) {
    try {
      const msg = await this.createUniversalMessage(event, eventType, extra);
      
      this.currentChatId = msg.conversation.id;
      
      await this.publisherClient.publish(this.C.CHANNEL, JSON.stringify(msg));

      if (msg.message) {
        await this.createMessageIndex(msg.universalId, msg);
      }
    } catch (e) {
      console.error(`Error procesando evento ${eventType} (${this.adapterId}):`, e);
    }
  }

  getTargetsForMessage(msg) {
    if (msg.author?.id === 'webUser') {
      return [{
        adapterId: msg.adapterId,
        chatId: msg.conversation.id,
        threadId: msg.thread?.id || null
      }];
    }

    const targets = [];
    const src = `${msg.adapterId}:${msg.conversation.id}${msg.thread?.id ? `/${msg.thread.id}` : ''}`;

    for (const rule of this.routingRules) {
      if (rule.isAll) {
        for (const t of rule.targets) {
          if (t.direction === 'in' || t.direction === 'inout') {
            targets.push(t);
          }
        }
      } else {
        const srcMatch = rule.targets.find(t =>
          t.adapterId === msg.adapterId &&
          t.chatId === msg.conversation.id &&
          (msg.thread?.id ? t.threadId === msg.thread.id : t.threadId === null) &&
          (t.direction === 'out' || t.direction === 'inout')
        );
        
        if (srcMatch) {
          for (const t of rule.targets) {
            if ((t.direction === 'in' || t.direction === 'inout') && 
                `${t.adapterId}:${t.chatId}${t.threadId ? `/${t.threadId}` : ''}` !== src) {
              targets.push(t);
            }
          }
        }
      }
    }

    return targets.filter(t => t.adapterId === this.adapterId);
  }

  async setupGlobalSubscriber() {
    await this.subscriberClient.subscribe(this.C.CHANNEL, async (msgStr) => {
      try {
        const msg = JSON.parse(msgStr);
        if (msg.author?.bot === true && !msg.isPluginResponse) return;
        
        const targets = this.getTargetsForMessage(msg);
        
        for (const target of targets) {
          const src = `${msg.adapterId}:${msg.conversation.id}${msg.thread?.id ? `/${msg.thread.id}` : ''}`;
          const dst = `${target.adapterId}:${target.chatId}${target.threadId ? `/${target.threadId}` : ''}`;
          
          if (src === dst && !msg.isPluginResponse) continue;
          
          this.currentChatId = target.chatId;
          await this.sendToTarget(msg, target);
        }
      } catch (e) {
        console.error('Error procesando mensaje de suscripción:', e);
      }
    });
  }

  async sendToTarget(msg, target) {
    try {
      let replyTo = null;
      if (msg.message?.replyTo?.universalId) {
        this.currentChatId = target.chatId;
        replyTo = await this.resolveReplyTo(msg.message.replyTo.universalId);
      }

      const platform = msg.platform.toUpperCase();
      const author = msg.author.displayName || 'Usuario Desconocido';
      const conv = msg.conversation.name || '';
      let text = msg.message?.text || '';
      
      if (!msg.isPluginResponse) {
        text = `[${platform}] ${author} (${conv}):\n${text}`;
      }

      const result = await this.sendMessage(target.chatId, target.threadId, text, msg.attachments, replyTo, msg.apiCall);
      
      if (result && result.messageId) {
        await this.createMessageIndex(msg.universalId, {
          universalId: msg.universalId,
          platform: this.platform,
          adapterId: this.adapterId,
          message: { id: result.messageId },
          conversation: { id: target.chatId },
          thread: { id: target.threadId || null },
          author: { id: 'system' },
          timestamp: Date.now()
        });
      }
    } catch (e) {
      console.error(`Error enviando a ${target.chatId}:`, e);
    }
  }

  async executeApiCall(apiCall) {
    console.log(`[API] ${this.adapterId} no implementa executeApiCall`);
  }

  async cleanup() {
    if (this.publisherClient) await this.publisherClient.quit();
    if (this.subscriberClient) await this.subscriberClient.quit();
    if (this.indexClient) await this.indexClient.quit();
    process.exit(0);
  }

  async createUniversalMessage(event, eventType, extra) {
    throw new Error('createUniversalMessage debe implementarse en subclase');
  }

  async sendMessage(chatId, threadId, text, attachments, replyTo, apiCall) {
    throw new Error('sendMessage debe implementarse en subclase');
  }

  setupEventHandlers() {
    throw new Error('setupEventHandlers debe implementarse en subclase');
  }

  async init() {
    await this.initClients();
    this.setupEventHandlers();
    
    process.on('SIGINT', () => this.cleanup());
    process.on('SIGTERM', () => this.cleanup());
    
    console.log(`Ejecutando ${this.adapterId}`);
  }
}
