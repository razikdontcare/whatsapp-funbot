import { CommandInterface } from "./CommandInterface.js";
import { SessionService } from "../services/SessionService.js";
import { CommandUsageService } from "../services/CommandUsageService.js";
import { BotConfig, log, getUserRoles } from "./config.js";
import { WebSocketInfo } from "./types.js";
import { CooldownManager } from "./CooldownManager.js";
import { proto } from "baileys";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CommandInfo {
  name: string;
  aliases?: string[];
  description: string;
  helpText?: string; // Inline command documentation
  category: "game" | "general" | "admin" | "utility";
  commandClass: new () => CommandInterface;
  cooldown?: number;
  maxUses?: number;
  requiredRoles?: import("./config.js").UserRole[];
}

export class CommandHandler {
  private commands: Map<string, CommandInfo> = new Map();
  private aliases: Map<string, string> = new Map();
  private cooldownManager: CooldownManager = new CooldownManager();

  constructor(
    private sessionService: SessionService,
    private usageService?: CommandUsageService
  ) {
    // this.registerCommands();
    setInterval(() => this.sessionService.cleanupExpiredSessions(), 1800000); // 30 minutes
  }

  async registerCommands() {
    const commandsDir = path.resolve(__dirname, "../commands");
    const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith(".js"));
    // .filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
    for (const file of files) {
      const commandModule = await import(path.join(commandsDir, file));
      // Support both default and named exports
      const CommandClass =
        commandModule.default || Object.values(commandModule)[0];
      if (!CommandClass || !CommandClass.commandInfo) continue;
      this.registerCommand(CommandClass.commandInfo);
    }
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

      if (command === "stats" && this.usageService) {
        await this.handleStatsCommand(jid, sock, user, args);
        return;
      }

      const commandInfo = this.getCommandInfo(command);
      if (commandInfo) {
        // Permission check for requiredRoles (type-safe, supports multiple roles)
        if (commandInfo.requiredRoles && commandInfo.requiredRoles.length > 0) {
          const userRoles = getUserRoles(user);
          const hasRole = commandInfo.requiredRoles.some((role) =>
            userRoles.includes(role)
          );
          if (!hasRole) {
            await sock.sendMessage(jid, {
              text: `${BotConfig.emoji.error} Kamu tidak memiliki izin untuk menggunakan perintah ini.`,
            });
            return;
          }
        }

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

        // Increment usage stats if service is available
        if (this.usageService) {
          await this.usageService.increment(commandInfo.name, user);
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
      await sock.sendMessage(jid, {
        text: `Perintah *${BotConfig.prefix}${args[0]}* tidak ditemukan.\nGunakan ${BotConfig.prefix}help untuk melihat daftar perintah yang tersedia.`,
      });
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

    if (commandInfo.helpText) {
      helpText += commandInfo.helpText;
    }

    await sock.sendMessage(jid, { text: helpText });
  }

  private async handleStatsCommand(
    jid: string,
    sock: WebSocketInfo,
    user: string,
    args: string[]
  ) {
    if (!this.usageService) {
      await sock.sendMessage(jid, { text: "Statistik tidak tersedia." });
      return;
    }
    let statsText = "";
    if (args.length > 0) {
      // Show stats for a specific command
      const command = args[0].toLowerCase();
      const stats = await this.usageService.getCommandStats(command);
      if (stats.length === 0) {
        statsText = `Belum ada statistik untuk perintah *${command}*.`;
      } else {
        statsText =
          `Statistik penggunaan *${command}*:\n` +
          stats
            .map(
              (s, i) =>
                `${i + 1}. ${s.user}: ${
                  s.count
                }x (terakhir: ${s.lastUsed.toLocaleString()})`
            )
            .join("\n");
      }
    } else {
      // Show global stats
      const allStats = await this.usageService.getAllStats();
      if (allStats.length === 0) {
        statsText = "Belum ada statistik penggunaan perintah.";
      } else {
        // Aggregate by command
        const byCommand: Record<string, number> = {};
        for (const s of allStats) {
          byCommand[s.command] = (byCommand[s.command] || 0) + s.count;
        }
        statsText =
          "Statistik penggunaan perintah:\n" +
          Object.entries(byCommand)
            .map(([cmd, count], i) => `${i + 1}. *${cmd}*: ${count}x`)
            .join("\n");
      }
    }
    await sock.sendMessage(jid, { text: statsText });
  }
}
