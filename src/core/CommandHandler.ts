import { CommandInterface } from "./CommandInterface.js";
import { SessionService } from "../services/SessionService.js";
import { BotConfig, log } from "./config.js";
import { WebSocketInfo } from "./types.js";

import { HangmanGame } from "../games/HangmanGame.js";
import { RockPaperScissorsGame } from "../games/RockPaperScissorsGame.js";
import { FufufafaComments } from "../general/FufufafaComments.js";
import { proto } from "baileys";

export class CommandHandler {
  private games: Map<string, new () => CommandInterface> = new Map();
  private general: Map<string, new () => CommandInterface> = new Map();
  private aliases: Map<string, string> = new Map();

  constructor(private sessionService: SessionService) {
    this.registerGame();
    this.registerGeneralCommand();
    setInterval(() => this.sessionService.cleanupExpiredSessions(), 1800000); // 30 minutes
  }

  private registerGame() {
    this.games.set("hangman", HangmanGame);
    this.setAlias("hm", "hangman");

    this.games.set("rps", RockPaperScissorsGame);
  }

  private registerGeneralCommand() {
    this.general.set("fufufafa", FufufafaComments);
  }

  private setAlias(alias: string, command: string): void {
    this.aliases.set(alias.toLowerCase(), command.toLowerCase());
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
    sock: WebSocketInfo,
    msg: proto.IWebMessageInfo
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

      // Check if the command is an alias, and if so, get the actual command
      const actualCommand = this.aliases.has(command)
        ? this.aliases.get(command)!
        : command;

      if (this.games.has(actualCommand)) {
        await this.handleGameCommand(actualCommand, args, jid, user, sock, msg);
      } else if (this.general.has(actualCommand)) {
        await this.handleGeneralCommand(
          actualCommand,
          args,
          jid,
          user,
          sock,
          msg
        );
      } else {
        await sock.sendMessage(jid, {
          text: BotConfig.unknownCommandResponse.replace(
            "{prefix}",
            BotConfig.prefix
          ),
        });
      }
    } catch (error) {
      log.error(`Error handling command: ${error}`);
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

  private async handleGeneralCommand(
    command: string,
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    msg: proto.IWebMessageInfo
  ) {
    const GeneralClass = this.general.get(command)!;
    const general = new GeneralClass();

    await general.handleCommand(
      args,
      jid,
      user,
      sock,
      this.sessionService,
      msg
    );
  }

  private async handleGameCommand(
    command: string,
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    msg: proto.IWebMessageInfo
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

    await game.handleCommand(args, jid, user, sock, this.sessionService, msg);
  }
}
