import { makeWASocket, DisconnectReason, useMultiFileAuthState } from "baileys";
import { CommandHandler } from "./CommandHandler.js";
import { SessionService } from "../services/SessionService.js";
import { BotConfig } from "./config.js";
import { WebSocketInfo } from "./types.js";
import { Boom } from "@hapi/boom";

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
    });

    this.botId = this.sock.authState.creds.me?.id.split(":")[0] || null;

    this.sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === "close") {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !==
          DisconnectReason.loggedOut;
        console.log(
          "Connection closed due to ",
          lastDisconnect?.error,
          ", reconnecting ",
          shouldReconnect
        );
        if (shouldReconnect) this.start();
      } else if (connection === "open") {
        console.log(
          `Connected to WhatsApp as ${this.botId} with session name ${BotConfig.sessionName}\n` +
            `Bot Name: ${BotConfig.name}\n` +
            `Prefix: ${BotConfig.prefix}\n`
        );
      }
    });

    this.sock.ev.on("creds.update", saveCreds);

    this.sock.ev.on("messages.upsert", async ({ messages }) => {
      try {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

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
              this.sock!
            );
          }
          return;
        }

        if (this.commandHandler.isCommand(text)) {
          await this.commandHandler.handleCommand(text, jid, user, this.sock!);
        }
      } catch (error) {
        console.error("Error handling message: ", error);
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
