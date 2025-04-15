import { CommandInterface } from "./CommandInterface.js";
import { SessionService } from "../services/SessionService.js";
import { BotConfig } from "./config.js";
import { WebSocketInfo } from "./types.js";

import { HangmanGame } from "../games/HangmanGame.js";
import { RockPaperScissorsGame } from "../games/RockPaperScissorsGame.js";

export class CommandHandler {
  private games: Map<string, new () => CommandInterface> = new Map();

  constructor(private sessionService: SessionService) {
    this.registerGame();
    setInterval(() => this.sessionService.cleanupExpiredSessions(), 1800000); // 30 minutes
  }

  private registerGame() {
    this.games.set("hangman", HangmanGame);
    this.games.set("rps", RockPaperScissorsGame);
  }

  isCommand(text: string): boolean {
    if (!text) return false;

    if (BotConfig.prefix && text.startsWith(BotConfig.prefix)) return true;

    for (const prefix of BotConfig.alternativePrefixes) {
      if (text.startsWith(prefix)) return true;
    }

    return false;
  }

  private extractCommand(text: string): { command: string; args: string[] } {
    let usedPrefix = BotConfig.prefix;
    for (const prefix of [BotConfig.prefix, ...BotConfig.alternativePrefixes]) {
      if (text.startsWith(prefix)) {
        usedPrefix = prefix;
        break;
      }
    }

    const [command, ...args] = text
      .slice(usedPrefix.length)
      .trim()
      .split(/\s+/);
    return { command: command.toLocaleLowerCase(), args };
  }

  async handleCommand(
    text: string,
    jid: string,
    user: string,
    sock: WebSocketInfo
  ): Promise<void> {
    try {
      const { command, args } = this.extractCommand(text);

      if (command === "games") {
        await this.listGames(jid, sock);
        return;
      }

      if (command === "stop") {
        await this.handleStopCommand(jid, user, sock);
        return;
      }

      if (this.games.has(command)) {
        await this.handleGameCommand(command, args, jid, user, sock);
      } else {
        await sock.sendMessage(jid, {
          text: BotConfig.unknownCommandResponse.replace(
            "{prefix}",
            BotConfig.prefix
          ),
        });
      }
    } catch (error) {
      console.error(`Error handling command: ${error}`);
      await sock.sendMessage(jid, {
        text: "Terjadi error saat memproses perintah. Silahkan coba lagi.",
      });
    }
  }

  private async listGames(jid: string, sock: WebSocketInfo) {
    const gameList = Array.from(this.games.keys())
      .map((g) => `• *${BotConfig.prefix}${g}* - ${this.getGameDescription(g)}`)
      .join("\n");

    await sock.sendMessage(jid, {
      text: `🎮 Daftar Game yang Tersedia:\n${gameList}\n\nGunakan ${BotConfig.prefix}<nama game> start untuk memulai.`,
    });
  }

  private getGameDescription(gameName: string): string {
    switch (gameName) {
      case "hangman":
        return "Game tebak kata. Tebak huruf untuk menemukan kata yang tersembunyi.";
      case "rps":
        return "Batu-Gunting-Kertas (vs AI/Multiplayer)";
      default:
        return "_Deskripsi tidak tersedia._";
    }
  }

  private async handleStopCommand(
    jid: string,
    user: string,
    sock: WebSocketInfo
  ) {
    const session = this.sessionService.getSession(jid, user);
    if (session) {
      this.sessionService.clearSession(jid, user);
      await sock.sendMessage(jid, {
        text: `Game ${session.game} telah dihentikan.`,
      });
    } else {
      await sock.sendMessage(jid, {
        text: "Tidak ada game yang sedang berjalan.",
      });
    }
  }

  private async handleGameCommand(
    command: string,
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo
  ) {
    const GameClass = this.games.get(command)!;
    const game = new GameClass();

    const existingSession = this.sessionService.getSession(jid, user);

    if (existingSession && existingSession.game !== command) {
      // Special case: Allow RPS commands if the session is an RPS multiplayer link
      if (command === "rps" && existingSession.game === "rps_link") {
        // This is fine - let the RPS game handle its link sessions
      } else {
        await sock.sendMessage(jid, {
          text: `Kamu sedang dalam game ${existingSession.game}. Akhiri dulu dengan ${BotConfig.prefix}stop.`,
        });
        return;
      }
    }

    await game.handleCommand(args, jid, user, sock, this.sessionService);
  }
}
