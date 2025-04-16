import { makeWASocket, DisconnectReason, useMultiFileAuthState } from "baileys";
import { CommandHandler } from "./CommandHandler.js";
import { SessionService } from "../services/SessionService.js";
import { BotConfig } from "./config.js";
import { WebSocketInfo } from "./types.js";
import { Boom } from "@hapi/boom";
import { log } from "./config.js";
import MAIN_LOGGER from "baileys/lib/Utils/logger.js";

const logger = MAIN_LOGGER.default.child({});
logger.level = "silent";

export class BotClient {
  private sock: WebSocketInfo | null = null;
  private commandHandler: CommandHandler;
  private sessionService: SessionService;
  private botId: string | null = null;

  constructor() {
    this.sessionService = new SessionService();
    this.commandHandler = new CommandHandler(this.sessionService);
  }

  async start() {
    const { state, saveCreds } = await useMultiFileAuthState(
      BotConfig.sessionName + "_session"
    );

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger,
    });

    this.botId = this.sock.authState.creds.me?.id.split(":")[0] || null;

    this.sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === "close") {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !==
          DisconnectReason.loggedOut;
        log.warn(
          "Connection closed due to ",
          lastDisconnect?.error?.message,
          ", reconnecting ",
          shouldReconnect
        );
        if (shouldReconnect) this.start();
      } else if (connection === "open") {
        log.info(
          `Connected to WhatsApp as ${this.botId} with session name ${BotConfig.sessionName}`
        );
        log.info(`Bot Name: ${BotConfig.name}`);
        log.info(`Prefix: ${BotConfig.prefix}`);
      }
    });

    this.sock.ev.on("creds.update", saveCreds);

    this.sock.ev.on("messages.upsert", async ({ messages }) => {
      try {
        const m = messages[0];
        if (!m.message) return;
        if (m.key.fromMe && !BotConfig.allowFromMe) return;

        const text =
          m.message.conversation || m.message.extendedTextMessage?.text || "";
        const jid = m.key.remoteJid!;
        const user = m.key.participant || jid;

        if (
          BotConfig.allowMentionPrefix &&
          this.botId &&
          text.includes(`@${this.botId}`)
        ) {
          const commandText = this.extractCommandFromMention(text, this.botId);
          if (commandText) {
            await this.commandHandler.handleCommand(
              BotConfig.prefix + commandText,
              jid,
              user,
              this.sock!,
              m
            );
          }
          return;
        }

        if (this.commandHandler.isCommand(text)) {
          await this.commandHandler.handleCommand(
            text,
            jid,
            user,
            this.sock!,
            m
          );
        }
      } catch (error) {
        log.error("Error handling message: ", error);
      }
    });
  }

  private extractCommandFromMention(
    text: string,
    botId: string
  ): string | null {
    const mentionPattern = new RegExp(`@${botId}\\s+(.+)`, "i");
    const match = text.match(mentionPattern);
    return match ? match[1].trim() : null;
  }
}
