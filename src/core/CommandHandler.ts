import { CommandInterface } from "./CommandInterface.js";
import { SessionService } from "../services/SessionService.js";
import { BotConfig, log } from "./config.js";
import { WebSocketInfo } from "./types.js";
import { CooldownManager } from "./CooldownManager.js";

import { HangmanGame } from "../games/HangmanGame.js";
import { RockPaperScissorsGame } from "../games/RockPaperScissorsGame.js";
import { FufufafaComments } from "../general/FufufafaComments.js";
import { MPLIDInfo } from "../general/MPLIDInfo.js";
import { proto } from "baileys";

export interface CommandInfo {
  name: string;
  aliases?: string[];
  description: string;
  category: "game" | "general" | "admin" | "utility";
  commandClass: new () => CommandInterface;
  cooldown?: number; // Cooldown in milliseconds
  maxUses?: number; // Maximum uses before cooldown triggers
}

export class CommandHandler {
  private commands: Map<string, CommandInfo> = new Map();
  private aliases: Map<string, string> = new Map();
  private cooldownManager: CooldownManager = new CooldownManager();

  constructor(private sessionService: SessionService) {
    this.registerCommands();
    setInterval(() => this.sessionService.cleanupExpiredSessions(), 1800000); // 30 minutes
  }

  private registerCommands() {
    this.registerCommand({
      name: "hangman",
      aliases: ["hm", "tebakkata"],
      description:
        "Game tebak kata. Tebak huruf untuk menemukan kata yang tersembunyi.",
      category: "game",
      commandClass: HangmanGame,
      cooldown: 5000,
    });

    this.registerCommand({
      name: "rps",
      aliases: [],
      description: "Batu-Gunting-Kertas (vs AI/Multiplayer)",
      category: "game",
      commandClass: RockPaperScissorsGame,
      cooldown: 3000,
    });

    this.registerCommand({
      name: "fufufafa",
      description:
        "Komentar random dari akun Kaskus Fufufafa. (Total 699 komentar)",
      category: "general",
      commandClass: FufufafaComments,
      cooldown: 10000,
      maxUses: 3,
    });

    this.registerCommand({
      name: "mplid",
      description: "Informasi tentang MPL Indonesia (MPLID)",
      category: "general",
      commandClass: MPLIDInfo,
      cooldown: 5000,
      maxUses: 3,
    });
  }

  private registerCommand(info: CommandInfo): void {
    this.commands.set(info.name.toLowerCase(), info);

    if (info.aliases) {
      for (const alias of info.aliases) {
        this.aliases.set(alias.toLowerCase(), info.name.toLowerCase());
      }
    }
  }

  private isGameCommand(command: string): boolean {
    const info = this.getCommandInfo(command);
    return info ? info.category === "game" : false;
  }

  private isGeneralCommand(command: string): boolean {
    const info = this.getCommandInfo(command);
    return info ? info.category === "general" : false;
  }

  private isAdminCommand(command: string): boolean {
    const info = this.getCommandInfo(command);
    return info ? info.category === "admin" : false;
  }

  private getCommandInfo(command: string): CommandInfo | undefined {
    // Check if it's an alias first
    const actualCommand = this.aliases.has(command)
      ? this.aliases.get(command)!
      : command;

    return this.commands.get(actualCommand);
  }

  private getCommandInstance(command: string): CommandInterface {
    const info = this.getCommandInfo(command);
    if (!info) {
      throw new Error(`Command not found: ${command}`);
    }

    return new info.commandClass();
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

      // Handle built-in commands
      if (command === "games") {
        await this.listGames(jid, sock);
        return;
      }

      if (command === "help") {
        await this.handleHelpCommand(args, jid, sock);
        return;
      }

      if (command === "stop") {
        await this.handleStopCommand(jid, user, sock);
        return;
      }

      const commandInfo = this.getCommandInfo(command);

      if (commandInfo) {
        const actualCommand = commandInfo.name;

        if (commandInfo.cooldown) {
          const cooldownTime = commandInfo.cooldown;
          const maxUses = commandInfo.maxUses || 1;

          if (
            this.cooldownManager.isOnCooldown(
              user,
              actualCommand,
              cooldownTime,
              maxUses
            )
          ) {
            const remainingTime = this.cooldownManager.getRemainingCooldown(
              user,
              actualCommand,
              cooldownTime
            );
            await sock.sendMessage(jid, {
              text: `${BotConfig.emoji.error} Kamu terlalu cepat menggunakan perintah ini. Coba lagi dalam ${remainingTime} detik.`,
            });
            return;
          }
        }

        if (commandInfo.category === "game") {
          await this.handleGameCommand(
            actualCommand,
            args,
            jid,
            user,
            sock,
            msg
          );
        } else if (commandInfo.category === "general") {
          await this.handleGeneralCommand(
            actualCommand,
            args,
            jid,
            user,
            sock,
            msg
          );
        } else if (commandInfo.category === "admin") {
          await this.handleAdminCommand(
            actualCommand,
            args,
            jid,
            user,
            sock,
            msg
          );
        } else {
          await this.handleUtilityCommand(
            actualCommand,
            args,
            jid,
            user,
            sock,
            msg
          );
        }
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
        text: BotConfig.messages.commandError,
      });
    }
  }

  private async handleGameCommand(
    command: string,
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    msg: proto.IWebMessageInfo
  ) {
    const commandInstance = this.getCommandInstance(command);
    const existingSession = this.sessionService.getSession(jid, user);

    if (existingSession && existingSession.game !== command) {
      // Special case: Allow RPS commands if the session is an RPS multiplayer link
      if (command === "rps" && existingSession.game === "rps_link") {
        // This is fine - let the RPS game handle its link sessions
      } else {
        await sock.sendMessage(jid, {
          text: BotConfig.messages.gameInProgress
            .replace("{game}", existingSession.game)
            .replace("{prefix}", BotConfig.prefix),
        });
        return;
      }
    }

    await commandInstance.handleCommand(
      args,
      jid,
      user,
      sock,
      this.sessionService,
      msg
    );
  }

  private async handleGeneralCommand(
    command: string,
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    msg: proto.IWebMessageInfo
  ) {
    const commandInstance = this.getCommandInstance(command);
    await commandInstance.handleCommand(
      args,
      jid,
      user,
      sock,
      this.sessionService,
      msg
    );
  }

  private async handleAdminCommand(
    command: string,
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    msg: proto.IWebMessageInfo
  ) {
    // TODO: Check if user is admin before executing admin commands
    // For now we'll just execute the command like a general command
    const commandInstance = this.getCommandInstance(command);
    await commandInstance.handleCommand(
      args,
      jid,
      user,
      sock,
      this.sessionService,
      msg
    );
  }

  private async handleUtilityCommand(
    command: string,
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    msg: proto.IWebMessageInfo
  ) {
    const commandInstance = this.getCommandInstance(command);
    await commandInstance.handleCommand(
      args,
      jid,
      user,
      sock,
      this.sessionService,
      msg
    );
  }

  private async listGames(jid: string, sock: WebSocketInfo) {
    const gameCommands = Array.from(this.commands.values()).filter(
      (cmd) => cmd.category === "game"
    );

    const gameList = gameCommands
      .map((game) => {
        let aliasText = "";
        if (game.aliases && game.aliases.length > 0) {
          aliasText = ` (alias: ${game.aliases
            .map((a) => `*${BotConfig.prefix}${a}*`)
            .join(", ")})`;
        }

        return `• *${BotConfig.prefix}${game.name}*${aliasText} - ${game.description}`;
      })
      .join("\n");

    await sock.sendMessage(jid, {
      text: `${BotConfig.emoji.games} Daftar Game yang Tersedia:\n${gameList}\n\nGunakan ${BotConfig.prefix}<nama game> start untuk memulai, atau ${BotConfig.prefix}help <nama game> untuk bantuan.`,
    });
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
        text: BotConfig.messages.gameStopped.replace("{game}", session.game),
      });
    } else {
      await sock.sendMessage(jid, {
        text: BotConfig.messages.noGameRunning,
      });
    }
  }

  private async handleHelpCommand(
    args: string[],
    jid: string,
    sock: WebSocketInfo
  ) {
    if (args.length === 0) {
      const gameCommands: string[] = [];
      const generalCommands: string[] = [];
      const adminCommands: string[] = [];
      const utilityCommands: string[] = [];

      for (const [_, info] of this.commands) {
        const commandText = `*${BotConfig.prefix}${info.name}* - ${info.description}`;

        switch (info.category) {
          case "game":
            gameCommands.push(commandText);
            break;
          case "general":
            generalCommands.push(commandText);
            break;
          case "admin":
            adminCommands.push(commandText);
            break;
          case "utility":
            utilityCommands.push(commandText);
            break;
        }
      }

      let helpText = `${BotConfig.emoji.help} *Bantuan ${BotConfig.name} Bot*\n\n`;

      helpText += `*Perintah Inti:*\n`;
      helpText += `*${BotConfig.prefix}games* - Melihat daftar game yang tersedia\n`;
      helpText += `*${BotConfig.prefix}help [command]* - Menampilkan bantuan untuk command tertentu\n`;
      helpText += `*${BotConfig.prefix}stop* - Menghentikan game yang sedang berjalan\n\n`;

      if (gameCommands.length > 0) {
        helpText += `*${BotConfig.emoji.games} Game:*\n${gameCommands.join(
          "\n"
        )}\n\n`;
      }

      if (generalCommands.length > 0) {
        helpText += `*${BotConfig.emoji.info} Umum:*\n${generalCommands.join(
          "\n"
        )}\n\n`;
      }

      if (adminCommands.length > 0) {
        helpText += `*Admin:*\n${adminCommands.join("\n")}\n\n`;
      }

      if (utilityCommands.length > 0) {
        helpText += `*Utilitas:*\n${utilityCommands.join("\n")}\n\n`;
      }

      helpText += `Gunakan ${BotConfig.prefix}help [nama perintah] untuk informasi lebih detail.`;

      await sock.sendMessage(jid, { text: helpText });
      return;
    }

    const commandName = args[0].toLowerCase();
    const commandInfo = this.getCommandInfo(commandName);

    if (!commandInfo) {
      let helpText = "";

      if (commandName === "games") {
        helpText =
          `*${BotConfig.prefix}games*\n` +
          `*Deskripsi:* Menampilkan daftar game yang tersedia\n\n` +
          `Ketik ${BotConfig.prefix}games untuk melihat semua game yang dapat dimainkan.`;
      } else if (commandName === "stop") {
        helpText =
          `*${BotConfig.prefix}stop*\n` +
          `*Deskripsi:* Menghentikan game yang sedang berjalan\n\n` +
          `Ketik ${BotConfig.prefix}stop untuk keluar dari game yang sedang kamu mainkan.`;
      } else if (commandName === "help") {
        helpText =
          `*${BotConfig.prefix}help [perintah]*\n` +
          `*Deskripsi:* Menampilkan bantuan untuk perintah tertentu\n\n` +
          `*Contoh:*\n` +
          `${BotConfig.prefix}help - Menampilkan semua bantuan\n` +
          `${BotConfig.prefix}help hangman - Bantuan untuk game Hangman`;
      } else {
        helpText =
          `Perintah *${BotConfig.prefix}${args[0]}* tidak ditemukan.\n` +
          `Gunakan ${BotConfig.prefix}help untuk melihat daftar perintah yang tersedia.`;
      }

      await sock.sendMessage(jid, { text: helpText });
      return;
    }

    let aliasText = "";
    if (commandInfo.aliases && commandInfo.aliases.length > 0) {
      aliasText = `\n*Alias:* ${commandInfo.aliases
        .map((a) => BotConfig.prefix + a)
        .join(", ")}`;
    }

    let helpText =
      `*${BotConfig.prefix}${commandInfo.name}*${aliasText}\n` +
      `*Deskripsi:* ${commandInfo.description}\n\n`;

    if (commandInfo.category === "game") {
      helpText += `*Cara bermain:*\n`;

      switch (commandInfo.name) {
        case "hangman":
          helpText +=
            `1. Ketik ${BotConfig.prefix}hangman start untuk memulai permainan baru\n` +
            `2. Bot akan menampilkan kata yang harus ditebak (tersembunyi)\n` +
            `3. Tebak huruf satu per satu dengan mengetik ${BotConfig.prefix}hangman [huruf]\n` +
            `4. Berhasil menebak semua huruf sebelum kesempatan habis untuk menang!\n`;
          break;
        case "rps":
          helpText +=
            `1. Ketik ${BotConfig.prefix}rps start untuk bermain dengan AI\n` +
            `2. Ketik ${BotConfig.prefix}rps multiplayer untuk bermain dengan pemain lain\n` +
            `3. Pilih batu, gunting, atau kertas saat giliran bermain\n`;
          break;
        default:
          helpText += `Gunakan ${BotConfig.prefix}${commandInfo.name} start untuk memulai.`;
      }
    } else if (commandInfo.category === "general") {
      helpText += `*Cara penggunaan:*\n`;

      switch (commandInfo.name) {
        case "fufufafa":
          helpText +=
            `1. Ketik ${BotConfig.prefix}fufufafa untuk mendapatkan komentar random dari akun Kaskus Fufufafa\n` +
            `2. Gunakan ${BotConfig.prefix}fufufafa [id] untuk mendapatkan komentar tertentu\n` +
            `3. Gunakan ${BotConfig.prefix}fufufafa [id] imgonly untuk mendapatkan gambar saja\n` +
            `4. Gunakan ${BotConfig.prefix}fufufafa [id] textonly untuk mendapatkan teks saja\n`;
          break;
        case "mplid":
          helpText +=
            `1. Ketik ${BotConfig.prefix}mplid teams untuk melihat daftar tim MPLID\n` +
            `2. Ketik ${BotConfig.prefix}mplid schedule untuk melihat jadwal MPLID\n` +
            `3. Ketik ${BotConfig.prefix}mplid standings untuk melihat klasemen MPLID\n` +
            `4. Ketik ${BotConfig.prefix}mplid team [team_id] untuk melihat informasi tim berdasarkan ID (ID Tim adalah singkatan nama tiap tim, contoh: "alter ego esports" memiliki ID "ae")\n`;
          break;
        default:
          helpText += `Gunakan ${BotConfig.prefix}${commandInfo.name} untuk menjalankan perintah ini.`;
      }
    } else {
      helpText += `Gunakan ${BotConfig.prefix}${commandInfo.name} untuk menjalankan perintah ini.`;
    }

    await sock.sendMessage(jid, { text: helpText });
  }
}
