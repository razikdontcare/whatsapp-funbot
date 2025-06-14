import { CommandInterface, CommandInfo } from "./CommandInterface.js";
import { SessionService } from "../services/SessionService.js";
import { CommandUsageService } from "../services/CommandUsageService.js";
import { log, getUserRoles, getCurrentConfig } from "./config.js";
import { WebSocketInfo } from "./types.js";
import { CooldownManager } from "./CooldownManager.js";
import { proto } from "baileys";
import os from "os";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class CommandHandler {
  private commands: Map<string, CommandInfo> = new Map();
  private aliases: Map<string, string> = new Map();
  private cooldownManager: CooldownManager = new CooldownManager();

  constructor(
    private sessionService: SessionService,
    private usageService?: CommandUsageService
  ) {
    // this.registerCommands();
    (async () => {
      await this.registerCommands();
    })();
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
      // log.debug(`Registered command: ${CommandClass.commandInfo.name}`);
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

  async isCommand(text: string): Promise<boolean> {
    if (!text) return false;

    const config = await getCurrentConfig();

    if (config.prefix && text.startsWith(config.prefix)) return true;

    for (const prefix of config.alternativePrefixes) {
      if (text.startsWith(prefix)) return true;
    }

    return false;
  }

  private async extractCommand(
    text: string
  ): Promise<{ command: string; args: string[] }> {
    const config = await getCurrentConfig();
    let usedPrefix = config.prefix;
    for (const prefix of [config.prefix, ...config.alternativePrefixes]) {
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
      const { command, args } = await this.extractCommand(text);
      const config = await getCurrentConfig();

      log.debug(
        `Handling command: ${command} with args: ${args.join(
          ", "
        )} for ${user} ${jid.endsWith("@g.us") ? "in " + jid : ""}`
      );

      await sock.readMessages([msg.key]);
      await sock.sendPresenceUpdate("composing", jid);

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
        if (commandInfo.disabled) {
          const reason =
            commandInfo.disabledReason || "Tidak ada alasan yang diberikan.";
          await sock.sendMessage(jid, {
            text: `${config.emoji.error} Perintah *${commandInfo.name}* telah dinonaktifkan. Alasan: ${reason}`,
          });
          return;
        }
        // Permission check for requiredRoles (type-safe, supports multiple roles)
        if (commandInfo.requiredRoles && commandInfo.requiredRoles.length > 0) {
          const userRoles = await getUserRoles(user);
          const hasRole = commandInfo.requiredRoles.some((role) =>
            userRoles.includes(role)
          );
          if (!hasRole) {
            const config = await getCurrentConfig();
            await sock.sendMessage(jid, {
              text: `${config.emoji.error} Kamu tidak memiliki izin untuk menggunakan perintah ini.`,
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
              text: `${config.emoji.error} Kamu terlalu cepat menggunakan perintah ini. Coba lagi dalam ${remainingTime} detik.`,
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

        await sock.sendPresenceUpdate("available", jid);
      } else {
        await sock.sendMessage(jid, {
          text: config.unknownCommandResponse.replace(
            "{prefix}",
            config.prefix
          ),
        });
        await sock.sendPresenceUpdate("available", jid);
      }
    } catch (error) {
      log.error(`Error handling command: ${error}`);
      const config = await getCurrentConfig();
      await sock.sendMessage(jid, {
        text: config.messages.commandError,
      });
      await sock.sendPresenceUpdate("available", jid);
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
    const existingSession = await this.sessionService.getSession(jid, user);
    const config = await getCurrentConfig();

    if (existingSession && existingSession.game !== command) {
      // Special case: Allow RPS commands if the session is an RPS multiplayer link
      if (command === "rps" && existingSession.game === "rps_link") {
        // This is fine - let the RPS game handle its link sessions
      } else {
        await sock.sendMessage(jid, {
          text: config.messages.gameInProgress
            .replace("{game}", existingSession.game)
            .replace("{prefix}", config.prefix),
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

    const config = await getCurrentConfig();

    const gameList = gameCommands
      .map((game) => {
        let aliasText = "";
        if (game.aliases && game.aliases.length > 0) {
          aliasText = ` (alias: ${game.aliases
            .map((a) => `*${config.prefix}${a}*`)
            .join(", ")})`;
        }

        return `• *${config.prefix}${game.name}*${aliasText} - ${game.description}`;
      })
      .join("\n");

    await sock.sendMessage(jid, {
      text: `${config.emoji.games} Daftar Game yang Tersedia:\n${gameList}\n\nGunakan ${config.prefix}<nama game> start untuk memulai, atau ${config.prefix}help <nama game> untuk bantuan.`,
    });
  }

  private async handleStopCommand(
    jid: string,
    user: string,
    sock: WebSocketInfo
  ) {
    const session = await this.sessionService.getSession(jid, user);
    const config = await getCurrentConfig();

    if (session) {
      await this.sessionService.clearSession(jid, user);
      await sock.sendMessage(jid, {
        text: config.messages.gameStopped.replace("{game}", session.game),
      });
    } else {
      await sock.sendMessage(jid, {
        text: config.messages.noGameRunning,
      });
    }
  }

  private async handleHelpCommand(
    args: string[],
    jid: string,
    sock: WebSocketInfo
  ) {
    const config = await getCurrentConfig();

    if (args.length === 0) {
      const gameCommands: string[] = [];
      const generalCommands: string[] = [];
      const adminCommands: string[] = [];
      const utilityCommands: string[] = [];

      for (const [_, info] of this.commands) {
        const commandText = `*${config.prefix}${info.name}* - ${info.description}`;

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

      let helpText = `${config.emoji.help} *Bantuan ${config.name} Bot*\n\n`;

      helpText += `*Perintah Inti:*\n`;
      helpText += `*${config.prefix}games* - Melihat daftar game yang tersedia\n`;
      helpText += `*${config.prefix}help [command]* - Menampilkan bantuan untuk command tertentu\n`;
      helpText += `*${config.prefix}stop* - Menghentikan game yang sedang berjalan\n\n`;

      if (gameCommands.length > 0) {
        helpText += `*${config.emoji.games} Game:*\n${gameCommands.join(
          "\n"
        )}\n\n`;
      }

      if (generalCommands.length > 0) {
        helpText += `*${config.emoji.info} Umum:*\n${generalCommands.join(
          "\n"
        )}\n\n`;
      }

      if (adminCommands.length > 0) {
        helpText += `*Admin:*\n${adminCommands.join("\n")}\n\n`;
      }

      if (utilityCommands.length > 0) {
        helpText += `*Utilitas:*\n${utilityCommands.join("\n")}\n\n`;
      }

      helpText += `Gunakan ${config.prefix}help [nama perintah] untuk informasi lebih detail.`;

      await sock.sendMessage(jid, { text: helpText });
      return;
    }

    const commandName = args[0].toLowerCase();
    const commandInfo = this.getCommandInfo(commandName);

    if (!commandInfo) {
      await sock.sendMessage(jid, {
        text: `Perintah *${config.prefix}${args[0]}* tidak ditemukan.\nGunakan ${config.prefix}help untuk melihat daftar perintah yang tersedia.`,
      });
      return;
    }

    let aliasText = "";
    if (commandInfo.aliases && commandInfo.aliases.length > 0) {
      aliasText = `\n*Alias:* ${commandInfo.aliases
        .map((a) => config.prefix + a)
        .join(", ")}`;
    }

    let helpText =
      `*${config.prefix}${commandInfo.name}*${aliasText}\n` +
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

        const uptimeSeconds = os.uptime();
        const days = Math.floor(uptimeSeconds / 86400);
        const hours = Math.floor((uptimeSeconds % 86400) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);

        let uptimeFormatted = [
          days > 0 ? `${days} hari` : "",
          hours > 0 ? `${hours} jam` : "",
          minutes > 0 ? `${minutes} menit` : `${uptimeSeconds % 60} detik`,
        ]
          .filter(Boolean)
          .join(" ");

        const systemStats = `System Stats:
*Hostname*  : ${os.hostname()}
*Platform*  : ${os.platform()}
*Uptime*    : ${uptimeFormatted}
*CPU Model* : ${os.cpus()[0].model}
*CPU Cores* : ${os.cpus().length}
*Memory*    : ${(os.freemem() / 1024 / 1024).toFixed(2)}/${(
          os.totalmem() /
          1024 /
          1024
        ).toFixed(2)} MB
*Load Avg*  : ${os
          .loadavg()
          .map((n) => n.toFixed(2))
          .join(", ")}
`;

        statsText =
          "Statistik penggunaan perintah:\n" +
          Object.entries(byCommand)
            .map(([cmd, count], i) => `${i + 1}. *${cmd}*: ${count}x`)
            .join("\n") +
          "\n\n" +
          systemStats;
      }
    }
    await sock.sendMessage(jid, { text: statsText });
  }
}
