import {
  Injectable,
  OnModuleInit,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService, ConfigType } from '@nestjs/config';
import makeWASocket, {
  DisconnectReason,
  WASocket,
  AuthenticationState,
  initAuthCreds,
  proto,
  SignalDataTypeMap,
  BaileysEventMap,
  BufferJSON,
} from '@whiskeysockets/baileys';
import * as crypto from 'crypto';
import { Bot, Group, Prisma } from '@prisma/client';
import P from 'pino';
import jwtConfig from 'src/auth/config/jwt.config';
import { EventsGateway } from 'src/events/events.gateway';
import { Mutex } from 'async-mutex';
import { adminCommands } from 'src/config/bot';
import { isAdmin } from 'src/utils/helpers';
import { helpCommand } from 'src/commands/help';
import { settings } from 'src/config/settings';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private activeBots: Map<string, WASocket> = new Map();
  private encryptionKey: Buffer;
  private connectionState = {
    retryCount: 0,
    maxRetries: 3,
    baseDelay: 2000, // 2 seconds
    maxDelay: 10000, // 10 seconds
  };
  private authStateMutex = new Mutex();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(jwtConfig.KEY)
    private readonly jwtConfiguration: ConfigType<typeof jwtConfig>,
    //TODO private eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => EventsGateway))
    private gateway: EventsGateway,
  ) {
    if (!this.jwtConfiguration?.secret)
      throw new Error('AUTH_SECRET not set in environment');
    this.encryptionKey = crypto.scryptSync(
      this.jwtConfiguration?.secret,
      'salt',
      32,
    );
  }

  async onModuleInit() {
    this.logger.log('Initializing WhatsApp service...');
    await this.restoreActiveBots();
  }

  // Enhanced encryption method with BufferJSON support
  private encrypt(data: any): Buffer {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);

    const dataString = JSON.stringify(data, BufferJSON.replacer);

    const encrypted = Buffer.concat([
      cipher.update(dataString),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]);
  }

  // Enhanced decryption method with BufferJSON support
  private decrypt(encryptedData: Buffer): any {
    try {
      const iv = encryptedData.subarray(0, 16);
      const authTag = encryptedData.subarray(16, 32);
      const encryptedContent = encryptedData.subarray(32);

      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        iv,
      );

      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(encryptedContent),
        decipher.final(),
      ]);

      return JSON.parse(decrypted.toString(), BufferJSON.reviver);
    } catch (error) {
      this.logger.error('Failed to decrypt auth state:', error);
      return null;
    }
  }

  // Comprehensive authentication state management
  private async loadAuthState(botId: string): Promise<{
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
  }> {
    const authState = await this.prisma.botAuthState.findUnique({
      where: { botId },
    });

    let creds = initAuthCreds();
    let keys: any = {};

    if (authState) {
      const decryptedCreds = this.decrypt(authState.creds);
      const decryptedKeys = this.decrypt(authState.keys);

      if (decryptedCreds && decryptedKeys) {
        creds = decryptedCreds;
        keys = decryptedKeys;
      }
    }

    return {
      state: {
        creds,
        keys: {
          get: async (type: keyof SignalDataTypeMap, ids: string[]) => {
            const data = keys[type];
            return ids.reduce((dict: any, id) => {
              if (data?.[id]) dict[id] = data[id];
              return dict;
            }, {});
          },
          set: async (data: any) => {
            for (const type in data) {
              keys[type] = keys[type] || {};
              Object.assign(keys[type], data[type]);
            }
            await this.saveAuthState(botId, creds, keys);
          },
        },
      },
      saveCreds: async () => {
        await this.saveAuthState(botId, creds, keys);
      },
    };
  }

  // Save authentication state with enhanced encryption
  private async saveAuthState(botId: string, creds: any, keys: any) {
    return this.authStateMutex.runExclusive(async () => {
      try {
        const encryptedCreds = this.encrypt(creds);
        const encryptedKeys = this.encrypt(keys);

        await this.prisma.botAuthState.upsert({
          where: { botId },
          create: {
            botId,
            creds: encryptedCreds,
            keys: encryptedKeys,
          },
          update: {
            creds: encryptedCreds,
            keys: encryptedKeys,
          },
        });
      } catch (error) {
        this.logger.error(`Failed to save auth state for bot ${botId}:`, error);
        throw error;
      }
    });
  }

  async createBot(
    userId: string,
    name: string,
    config: Prisma.JsonValue,
    phoneNumber?: string,
  ) {
    try {
      console.log('Creating bot for ', userId);
      const bot = await this.prisma.bot.create({
        data: {
          name,
          config,
          userId,
          status: 'INITIALIZING',
        },
      });
      this.gateway.server.emit(`bot:${userId}:bot`, bot);
      await this.createBotInstance(bot.id, phoneNumber);
      return bot;
    } catch (error) {
      this.logger.error('Failed to create bot:', error);
      throw error;
    }
  }

  private calculateRetryDelay(): number {
    const exponentialDelay =
      this.connectionState.baseDelay *
      Math.pow(2, this.connectionState.retryCount);
    return Math.min(exponentialDelay, this.connectionState.maxDelay);
  }

  async createBotInstancei(botId: string, phoneNumber?: string) {
    try {
      const bot = await this.prisma.bot.findUnique({
        where: { id: botId },
        include: { groups: true },
      });

      if (!bot) {
        throw new Error(`Bot ${botId} not found`);
      }

      const { state, saveCreds } = await this.loadAuthState(botId);

      const sock = makeWASocket({
        printQRInTerminal: false,
        auth: state,
        browser: ['Hyper Bot', 'Chrome', '1.0.0'],
        logger: P({ level: 'silent' }),
        defaultQueryTimeoutMs: 60000,
        qrTimeout: 40000,
        markOnlineOnConnect: true,
        keepAliveIntervalMs: 30000,
        emitOwnEvents: true,
        connectTimeoutMs: 60000,
        retryRequestDelayMs: this.calculateRetryDelay(),
      });

      if (phoneNumber && !sock.authState.creds?.registered) {
        try {
          const code = await sock.requestPairingCode(phoneNumber);
          this.logger.log(`Pairing code for ${phoneNumber}: ${code}`);
          this.gateway.server.emit(`pairing_code`, code);

          await this.prisma.bot.update({
            where: { id: botId },
            data: { status: 'AWAITING_QR_SCAN' },
          });
        } catch (error) {
          this.logger.error('Failed to request pairing code:', error);
        }
      }

      // Set up connection handling
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !phoneNumber) {
          // Only emit QR if not using pairing code
          this.gateway.server.emit(`qr_code`, qr);
          await this.prisma.bot.update({
            where: { id: botId },
            data: { status: 'AWAITING_QR_SCAN', qrCode: qr },
          });
        }

        if (connection === 'connecting') {
          this.gateway.server.emit(`bot:${botId}:status`, 'connecting');
          this.logger.log(`bot:${botId}:status::connecting`);
        }

        if (connection === 'open') {
          this.gateway.server.emit(`bot:${botId}:status`, 'connected');
          this.logger.log(`bot:${botId}:status::connected`);

          try {
            const botNumber = sock.user.id;

            await sock.sendMessage(botNumber, {
              text: `🎉 *${bot.name}* is connected!`,
              mentions: [botNumber],
            });
          } catch (error) {}

          await this.prisma.bot.update({
            where: { id: botId },
            data: { status: 'CONNECTED', qrCode: null },
          });
        }
      });

      // Save credentials on update
      sock.ev.on('creds.update', saveCreds);

      // Handle messages
      sock.ev.on('messages.upsert', async (messageUpdate) => {
        await this.handleMessages(sock, messageUpdate, bot);
      });

      this.activeBots.set(botId, sock);
      return sock;
    } catch (error) {
      this.logger.error(`Failed to create bot instance for ${botId}:`, error);
      throw error;
    }
  }

  async createBotInstance(botId: string, phoneNumber?: string) {
    try {
      // Reset retry count for a new connection attempt
      this.connectionState.retryCount = 0;

      const bot = await this.prisma.bot.findUnique({
        where: { id: botId },
        include: { groups: true },
      });

      if (!bot) {
        throw new Error(`Bot ${botId} not found`);
      }

      const { state, saveCreds } = await this.loadAuthState(botId);

      const sock = makeWASocket({
        printQRInTerminal: false,
        auth: state,
        browser: ['Hyper Bot', 'Chrome', '1.0.0'],
        logger: P({ level: 'silent' }),
        defaultQueryTimeoutMs: 60000,
        qrTimeout: 40000,
        markOnlineOnConnect: true,
        keepAliveIntervalMs: 30000,
        emitOwnEvents: true,
        connectTimeoutMs: 60000,
        retryRequestDelayMs: this.calculateRetryDelay(),
      });

      // Enhanced connection handling
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect =
            statusCode !== DisconnectReason.loggedOut &&
            this.connectionState.retryCount < this.connectionState.maxRetries;

          if (shouldReconnect) {
            this.connectionState.retryCount++;
            const delay = this.calculateRetryDelay();

            this.logger.warn(
              `Bot ${botId} disconnected. Reconnecting in ${delay / 1000}s. ` +
                `Attempt ${this.connectionState.retryCount}/${this.connectionState.maxRetries}`,
            );

            // Update bot status
            await this.prisma.bot.update({
              where: { id: botId },
              data: {
                status: 'RECONNECTING',
                lastConnectionAttempt: new Date(),
              },
            });

            // Schedule reconnection
            setTimeout(async () => {
              try {
                await this.createBotInstance(botId, phoneNumber);
              } catch (retryError) {
                this.logger.error(
                  `Failed to reconnect bot ${botId}`,
                  retryError,
                );
              }
            }, delay);
          } else {
            // Final failure - mark as error
            await this.prisma.bot.update({
              where: { id: botId },
              data: {
                status: 'ERROR',
                lastConnectionAttempt: new Date(),
              },
            });

            this.logger.error(`Bot ${botId} connection failed permanently`);
          }
        }

        // Set up connection handling
        sock.ev.on('connection.update', async (update) => {
          const { connection, lastDisconnect, qr } = update;

          if (qr && !phoneNumber) {
            // Only emit QR if not using pairing code
            this.gateway.server.emit(`qr_code`, qr);
            await this.prisma.bot.update({
              where: { id: botId },
              data: { status: 'AWAITING_QR_SCAN', qrCode: qr },
            });
          }

          if (connection === 'connecting') {
            this.gateway.server.emit(`bot:${botId}:status`, 'connecting');
            this.logger.log(`bot:${botId}:status::connecting`);
          }

          if (connection === 'open') {
            this.gateway.server.emit(`bot:${botId}:status`, 'connected');
            this.logger.log(`bot:${botId}:status::connected`);

            try {
              const botNumber = sock.user.id;

              await sock.sendMessage(botNumber, {
                text: `🎉 *${bot.name}* is connected!`,
                mentions: [botNumber],
              });
            } catch (error) {}

            await this.prisma.bot.update({
              where: { id: botId },
              data: { status: 'CONNECTED', qrCode: null },
            });
          }
        });

        // Save credentials on update
        sock.ev.on('creds.update', saveCreds);

        // Handle messages
        sock.ev.on('messages.upsert', async (messageUpdate) => {
          await this.handleMessages(sock, messageUpdate, bot);
        });

        this.activeBots.set(botId, sock);
      });

      // Rest of the existing method...
      return sock;
    } catch (error) {
      this.logger.error(`Failed to create bot instance for ${botId}:`, error);

      // Update bot status on initial creation failure
      await this.prisma.bot.update({
        where: { id: botId },
        data: {
          status: 'ERROR',
          lastConnectionAttempt: new Date(),
        },
      });

      throw error;
    }
  }

  private async handleMessages(
    sock: WASocket,
    messageUpdate: { messages: proto.IWebMessageInfo[]; type: string },
    bot: Bot & { groups: Group[] },
  ) {
    const { messages } = messageUpdate;
    const message = messages[0];
    const chatId = message.key.remoteJid;
    const senderId = message.key.participant || message.key.remoteJid;

    if (!message.message) return;

    const isGroup = chatId.endsWith('@g.us');

    if (isGroup) {
      if (!bot.groups.find((val) => val.groupId === chatId)) {
        const groupName = (await sock.groupMetadata(chatId)).subject;
        const existingGroup = await this.prisma.group.findFirst({
          where: { groupId: chatId },
        });
        if (existingGroup) {
          this.logger.log(`Group already exists: ${groupName}`);
          return;
        }
        const newGroup = await this.prisma.group.create({
          data: {
            groupId: chatId,
            name: groupName,
            botId: bot.id,
          },
        });
        this.logger.log(`New group added: ${newGroup.name}`);
      }
    }

    let userMessage =
      message.message?.conversation?.trim().toLowerCase() ||
      message.message?.extendedTextMessage?.text?.trim().toLowerCase() ||
      '';
    userMessage = userMessage.replace(/\.\s+/g, '.').trim();

    // Basic message response in private chat
    if (
      !isGroup &&
      (userMessage === 'hi' || userMessage === 'hello' || userMessage === 'bot')
    ) {
      await sock.sendMessage(chatId, {
        text: 'Hi, How can I help you?\nYou can use .menu for more info and commands.',
      });
      return;
    }

    // Ignore messages that don't start with a command prefix
    if (!userMessage.startsWith('.')) return;

    const isAdminCommand = adminCommands.some((cmd) =>
      userMessage.startsWith(cmd),
    );

    let isSenderAdmin = false;
    let isBotAdmin = false;
    if (isGroup && isAdminCommand) {
      const adminStatus = await isAdmin(sock, chatId, senderId);
      isSenderAdmin = adminStatus.isSenderAdmin;
      isBotAdmin = adminStatus.isBotAdmin;

      if (!isBotAdmin) {
        await sock.sendMessage(chatId, {
          text: 'Please make the bot an admin to use admin commands.',
        });
        return;
      }

      if (
        userMessage.startsWith('.mute') ||
        userMessage === '.unmute' ||
        userMessage.startsWith('.ban') ||
        userMessage.startsWith('.promote') ||
        userMessage.startsWith('.demote')
      ) {
        if (!isSenderAdmin && !message.key.fromMe) {
          await sock.sendMessage(chatId, {
            text: 'Sorry, only group admins can use this command.',
          });
          return;
        }
      }

      switch (true) {
        case userMessage === '.help' ||
          userMessage === '.menu' ||
          userMessage === '.bot' ||
          userMessage === '.list':
          await helpCommand(sock, chatId, settings.YTC);
          break;
      }
    }
    for (const message of messages) {
      if (message.key.remoteJid?.endsWith('@g.us')) {
        const group = bot.groups.find(
          (g) => g.groupId === message.key.remoteJid,
        );

        if (group?.isProtected) {
          await this.handleProtectedGroupMessage(sock, message, group);
        }
      }
    }
  }

  private async handleProtectedGroupMessage(
    sock: WASocket,
    message: proto.IWebMessageInfo,
    group: any,
  ) {
    const messageContent =
      message.message?.conversation ||
      message.message?.extendedTextMessage?.text ||
      '';

    if (/(https?:\/\/[^\s]+)|(www\.[^\s]+)/gi.test(messageContent)) {
      const isWhitelisted = group.whitelist.some((domain: string) =>
        messageContent.includes(domain),
      );

      if (!isWhitelisted) {
        try {
          await sock.sendMessage(message.key.remoteJid!, {
            delete: message.key,
          });

          await sock.sendMessage(message.key.remoteJid!, {
            text: `⚠️ Links are not allowed in this group. Message from @${message.key.participant?.split('@')[0]} was removed.`,
            mentions: [message.key.participant!],
          });

          // TODO:  this.eventEmitter.emit('group.link_removed', {
          //     groupId: group.id,
          //     messageFrom: message.key.participant,
          //   });
        } catch (error) {
          this.logger.error('Failed to handle protected group message:', error);
        }
      }
    }
  }

  async disconnectBot(botId: string) {
    try {
      const sock = this.activeBots.get(botId);
      if (sock) {
        await sock.logout();
        this.activeBots.delete(botId);
      }

      // Reset connection state
      this.connectionState.retryCount = 0;

      await this.prisma.bot.update({
        where: { id: botId },
        data: {
          status: 'DISCONNECTED',
          qrCode: null,
          lastConnectionAttempt: new Date(),
        },
      });

      // Clear auth state
      await this.prisma.botAuthState.delete({
        where: { botId },
      });
    } catch (error) {
      this.logger.error(`Failed to disconnect bot ${botId}:`, error);
      throw error;
    }
  }

  private async restoreActiveBots() {
    try {
      const activeBots = await this.prisma.bot.findMany({
        where: {
          status: {
            in: ['CONNECTED', 'INITIALIZING'],
          },
        },
      });

      for (const bot of activeBots) {
        await this.createBotInstance(bot.id);
      }

      this.logger.log(`Restored ${activeBots.length} active bots`);
    } catch (error) {
      this.logger.error('Failed to restore active bots:', error);
      throw error;
    }
  }

  async getBotStatus(botId: string) {
    return this.prisma.bot.findUnique({
      where: { id: botId },
      select: {
        id: true,
        name: true,
        status: true,
        qrCode: true,
        groups: {
          select: {
            id: true,
            groupId: true,
            name: true,
            isProtected: true,
            whitelist: true,
          },
        },
      },
    });
  }
}
