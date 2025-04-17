import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  AuthenticationState,
} from "baileys";
import { CommandHandler } from "./CommandHandler.js";
import { SessionService } from "../services/SessionService.js";
import { BotConfig } from "./config.js";
import { WebSocketInfo } from "./types.js";
import { Boom } from "@hapi/boom";
import { log } from "./config.js";
import { useMongoDBAuthState } from "./auth.js";
import MAIN_LOGGER from "baileys/lib/Utils/logger.js";

const logger = MAIN_LOGGER.default.child({});
logger.level = "silent";

// Maximum number of reconnection attempts
const MAX_RECONNECT_ATTEMPTS = 5;
// Delay between reconnection attempts (in ms)
const RECONNECT_INTERVAL = 3000;

export class BotClient {
  private sock: WebSocketInfo | null = null;
  private commandHandler: CommandHandler;
  private sessionService: SessionService;
  private botId: string | null = null;
  private reconnectAttempts: number = 0;
  private authState: {
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
    removeCreds: () => Promise<void>;
    close: () => Promise<void>;
  } | null = null;

  constructor() {
    this.sessionService = new SessionService();
    this.commandHandler = new CommandHandler(this.sessionService);
  }

  async start() {
    try {
      // Close previous auth if exists
      if (this.authState) {
        await this.authState
          .close()
          .catch((err) => log.error("Error closing previous auth state:", err));
      }

      // Connect to MongoDB and initialize auth state
      log.info("Initializing WhatsApp connection...");
      try {
        this.authState = await useMongoDBAuthState(
          process.env.MONGO_URI!,
          process.env.NODE_ENV !== "production" ? "baileys_auth_dev" : undefined
        );
        const { state, saveCreds, removeCreds, close } = this.authState;

        // Create a new socket connection
        this.sock = makeWASocket({
          auth: state,
          printQRInTerminal: true,
          logger,
          syncFullHistory: false,
          connectTimeoutMs: 60000, // Allow more time for initial connection
          keepAliveIntervalMs: 10000, // More frequent keep-alive pings
          retryRequestDelayMs: 2000, // Retry delay for failed requests
        });

        this.botId = this.sock.authState.creds.me?.id.split(":")[0] || null;
      } catch (error) {
        log.error("Failed to initialize WhatsApp session:", error);
        // Wait before trying to reconnect
        setTimeout(() => this.start(), RECONNECT_INTERVAL);
        return;
      }

      // Handle connection updates
      this.sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Display QR code refresh info if a new QR is generated
        if (qr) {
          log.info("New QR code generated, please scan with WhatsApp app");
          // Reset reconnect attempts when a new QR is shown
          this.reconnectAttempts = 0;
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as Boom)?.output
            ?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          log.warn(
            "Connection closed due to ",
            lastDisconnect?.error?.message,
            ", reconnection status: ",
            shouldReconnect ? "will reconnect" : "permanent disconnect"
          );

          if (shouldReconnect) {
            // Implement progressive reconnect with exponential backoff
            this.reconnectAttempts++;

            if (this.reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
              const delay = Math.min(
                RECONNECT_INTERVAL * Math.pow(1.5, this.reconnectAttempts - 1),
                60000 // Maximum 1 minute delay
              );

              log.info(
                `Reconnecting (attempt ${
                  this.reconnectAttempts
                }/${MAX_RECONNECT_ATTEMPTS}) in ${Math.round(delay / 1000)}s...`
              );

              // Clean up existing socket before reconnecting
              if (this.sock) {
                this.sock.end(lastDisconnect?.error);
                this.sock = null;
              }

              setTimeout(() => this.start(), delay);
            } else {
              log.error(
                `Exceeded maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}). Logging out and resetting state.`
              );
              this.resetAndLogout();
            }
          } else {
            this.resetAndLogout();
          }
        } else if (connection === "open") {
          // Reset reconnect attempts on successful connection
          this.reconnectAttempts = 0;

          log.info(
            `Connected to WhatsApp as ${this.botId} with session name ${BotConfig.sessionName}`
          );
          log.info(`Bot Name: ${BotConfig.name}`);
          log.info(`Prefix: ${BotConfig.prefix}`);
        }
      });

      this.sock.ev.on("creds.update", this.authState.saveCreds);

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
            const commandText = this.extractCommandFromMention(
              text,
              this.botId
            );
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
    } catch (error) {
      log.error("Error in start method:", error);
      // Try to restart after a delay if not already at max attempts
      if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts++;
        const delay = Math.min(
          RECONNECT_INTERVAL * Math.pow(1.5, this.reconnectAttempts - 1),
          60000
        );
        log.info(
          `Restarting after error (attempt ${
            this.reconnectAttempts
          }/${MAX_RECONNECT_ATTEMPTS}) in ${Math.round(delay / 1000)}s...`
        );
        setTimeout(() => this.start(), delay);
      } else {
        log.error("Too many restart attempts, giving up.");
      }
    }
  }

  private extractCommandFromMention(
    text: string,
    botId: string
  ): string | null {
    const mentionPattern = new RegExp(`@${botId}\\s+(.+)`, "i");
    const match = text.match(mentionPattern);
    return match ? match[1].trim() : null;
  }

  private async resetAndLogout() {
    if (!this.authState) return;

    try {
      const { removeCreds, close } = this.authState;

      // End WebSocket connection if it exists
      if (this.sock) {
        this.sock.end(new Error("Manual logout triggered"));
        this.sock = null;
      }

      // Clean up credentials
      await Promise.all([
        removeCreds().catch((err) =>
          log.error("Failed to remove credentials:", err)
        ),
        close().catch((err) =>
          log.error("Failed to close MongoDB connection:", err)
        ),
      ]);

      log.info("Logged out and reset connection state");

      // Reset connection state
      this.authState = null;
      this.reconnectAttempts = 0;

      // Optional: exit the process or restart with fresh state
      // process.exit(0);

      // Alternatively, restart with fresh state after a delay
      setTimeout(() => this.start(), 5000);
    } catch (error) {
      log.error("Error during logout:", error);
      process.exit(1); // Force exit on critical error
    }
  }
}
