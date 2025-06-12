import { CommandInterface } from "../core/CommandInterface.js";
import { WebSocketInfo } from "../core/types.js";
import { SessionService } from "../services/SessionService.js";
import { proto } from "baileys";
import {
  getUserRoles,
  getBotConfigService,
  getCurrentConfig,
  log,
} from "../core/config.js";
import { BotConfigService } from "../services/BotConfigService.js";

export class ConfigCommand implements CommandInterface {
  static commandInfo = {
    name: "config",
    aliases: ["cfg", "konfig"],
    description: "Manage bot configuration (admin only)",
    helpText: `*Usage:*
• config get [<parameter>] — Get current configuration or specific parameter
• config set <parameter> <value> — Set a configuration parameter
• config reset — Reset configuration to default values`,
    category: "admin",
    commandClass: ConfigCommand,
    requiredRoles: ["admin"],
  };

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    message: proto.IWebMessageInfo
  ): Promise<void> {
    const chatId = jid;
    const senderId = user;

    // Check if user has admin privileges
    const userRoles = await getUserRoles(senderId);
    if (!userRoles.includes("admin")) {
      await sock.sendMessage(chatId, {
        text: "❌ Hanya admin yang dapat menggunakan command ini.",
      });
      return;
    }

    if (args.length === 0) {
      await this.showHelp(sock, chatId);
      return;
    }

    const action = args[0].toLowerCase();
    const configService = await getBotConfigService();

    try {
      switch (action) {
        case "get":
          await this.handleGet(sock, chatId, args.slice(1), configService);
          break;
        case "set":
          await this.handleSet(
            sock,
            chatId,
            args.slice(1),
            configService,
            senderId
          );
          break;
        case "reset":
          await this.handleReset(sock, chatId, configService, senderId);
          break;
        case "add-admin":
          await this.handleAddRole(
            sock,
            chatId,
            args.slice(1),
            configService,
            "admin",
            senderId
          );
          break;
        case "remove-admin":
          await this.handleRemoveRole(
            sock,
            chatId,
            args.slice(1),
            configService,
            "admin",
            senderId
          );
          break;
        case "add-mod":
          await this.handleAddRole(
            sock,
            chatId,
            args.slice(1),
            configService,
            "moderator",
            senderId
          );
          break;
        case "remove-mod":
          await this.handleRemoveRole(
            sock,
            chatId,
            args.slice(1),
            configService,
            "moderator",
            senderId
          );
          break;
        case "add-vip":
          await this.handleAddRole(
            sock,
            chatId,
            args.slice(1),
            configService,
            "vip",
            senderId
          );
          break;
        case "remove-vip":
          await this.handleRemoveRole(
            sock,
            chatId,
            args.slice(1),
            configService,
            "vip",
            senderId
          );
          break;
        default:
          await this.showHelp(sock, chatId);
      }
    } catch (error) {
      log.error("Error in config command:", error);
      await sock.sendMessage(chatId, {
        text: "❌ Terjadi error saat memproses command konfigurasi.",
      });
    }
  }

  private async handleGet(
    sock: WebSocketInfo,
    chatId: string,
    args: string[],
    configService: BotConfigService
  ): Promise<void> {
    if (args.length === 0) {
      // Show all configuration
      const config = await getCurrentConfig();
      const configText = `
🛠️ *Konfigurasi Bot Saat Ini*

*Pengaturan Umum:*
• Nama: ${config.name}
• Prefix: ${config.prefix}
• Alternative Prefixes: ${config.alternativePrefixes.join(", ")}
• Allow Mention Prefix: ${config.allowMentionPrefix ? "Ya" : "Tidak"}
• Max Sessions: ${config.maxSessions}
• Session Timeout: ${config.sessionTimeout / 1000}s
• Allow From Me: ${config.allowFromMe ? "Ya" : "Tidak"}

*Game Settings:*
• Default Game Help: ${config.defaultGameHelp}
• Unknown Command Response: ${config.unknownCommandResponse}

*User Roles:*
• Admins: ${config.admins.length} user(s)
• Moderators: ${config.moderators.length} user(s)
• VIPs: ${config.vips.length} user(s)

*Emoji:*
• Games: ${config.emoji.games}
• Help: ${config.emoji.help}
• Error: ${config.emoji.error}
• Success: ${config.emoji.success}
• Info: ${config.emoji.info}
• Hangman: ${config.emoji.hangman}
• RPS: ${config.emoji.rps}
      `.trim();

      await sock.sendMessage(chatId, { text: configText });
    } else {
      // Show specific configuration
      const param = args[0].toLowerCase();
      const config = await getCurrentConfig();

      let value: any;
      switch (param) {
        case "prefix":
          value = config.prefix;
          break;
        case "name":
          value = config.name;
          break;
        case "maxsessions":
          value = config.maxSessions;
          break;
        case "sessiontimeout":
          value = config.sessionTimeout;
          break;
        case "allowfromme":
          value = config.allowFromMe;
          break;
        case "admins":
          value = config.admins.join("\\n");
          break;
        case "moderators":
          value = config.moderators.join("\\n");
          break;
        case "vips":
          value = config.vips.join("\\n");
          break;
        default:
          await sock.sendMessage(chatId, {
            text: `❌ Parameter '${param}' tidak ditemukan.`,
          });
          return;
      }

      await sock.sendMessage(chatId, {
        text: `📋 *${param}*: ${value}`,
      });
    }
  }

  private async handleSet(
    sock: WebSocketInfo,
    chatId: string,
    args: string[],
    configService: BotConfigService,
    senderId: string
  ): Promise<void> {
    if (args.length < 2) {
      await sock.sendMessage(chatId, {
        text: "❌ Format: config set <parameter> <value>",
      });
      return;
    }

    const param = args[0].toLowerCase();
    const value = args.slice(1).join(" ");

    let updateData: any = {};

    switch (param) {
      case "prefix":
        updateData.prefix = value;
        break;
      case "name":
        updateData.name = value;
        break;
      case "maxsessions":
        const maxSessions = parseInt(value);
        if (isNaN(maxSessions) || maxSessions < 1) {
          await sock.sendMessage(chatId, {
            text: "❌ Max sessions harus berupa angka positif.",
          });
          return;
        }
        updateData.maxSessions = maxSessions;
        break;
      case "sessiontimeout":
        const timeout = parseInt(value);
        if (isNaN(timeout) || timeout < 1000) {
          await sock.sendMessage(chatId, {
            text: "❌ Session timeout harus berupa angka dalam milidetik (min: 1000).",
          });
          return;
        }
        updateData.sessionTimeout = timeout;
        break;
      case "allowfromme":
        const allow =
          value.toLowerCase() === "true" || value.toLowerCase() === "ya";
        updateData.allowFromMe = allow;
        break;
      case "defaultgamehelp":
        updateData.defaultGameHelp = value;
        break;
      case "unknowncommandresponse":
        updateData.unknownCommandResponse = value;
        break;
      default:
        await sock.sendMessage(chatId, {
          text: `❌ Parameter '${param}' tidak dapat diubah melalui command ini.`,
        });
        return;
    }

    const success = await configService.updateConfig(updateData, senderId);

    if (success) {
      await sock.sendMessage(chatId, {
        text: `✅ Konfigurasi '${param}' berhasil diperbarui menjadi: ${value}`,
      });
    } else {
      await sock.sendMessage(chatId, {
        text: "❌ Gagal memperbarui konfigurasi.",
      });
    }
  }

  private async handleReset(
    sock: WebSocketInfo,
    chatId: string,
    configService: BotConfigService,
    senderId: string
  ): Promise<void> {
    const success = await configService.resetToDefaults(senderId);

    if (success) {
      await sock.sendMessage(chatId, {
        text: "✅ Konfigurasi bot berhasil direset ke pengaturan default.",
      });
    } else {
      await sock.sendMessage(chatId, {
        text: "❌ Gagal mereset konfigurasi.",
      });
    }
  }

  private async handleAddRole(
    sock: WebSocketInfo,
    chatId: string,
    args: string[],
    configService: BotConfigService,
    role: "admin" | "moderator" | "vip",
    senderId: string
  ): Promise<void> {
    if (args.length === 0) {
      await sock.sendMessage(chatId, {
        text: `❌ Format: config add-${role} <user_jid>`,
      });
      return;
    }

    const userJid = args[0];
    const success = await configService.addUserToRole(userJid, role, senderId);

    if (success) {
      await sock.sendMessage(chatId, {
        text: `✅ User berhasil ditambahkan ke role ${role}.`,
      });
    } else {
      await sock.sendMessage(chatId, {
        text: `❌ Gagal menambahkan user ke role ${role}.`,
      });
    }
  }

  private async handleRemoveRole(
    sock: WebSocketInfo,
    chatId: string,
    args: string[],
    configService: BotConfigService,
    role: "admin" | "moderator" | "vip",
    senderId: string
  ): Promise<void> {
    if (args.length === 0) {
      await sock.sendMessage(chatId, {
        text: `❌ Format: config remove-${role} <user_jid>`,
      });
      return;
    }

    const userJid = args[0];
    const success = await configService.removeUserFromRole(
      userJid,
      role,
      senderId
    );

    if (success) {
      await sock.sendMessage(chatId, {
        text: `✅ User berhasil dihapus dari role ${role}.`,
      });
    } else {
      await sock.sendMessage(chatId, {
        text: `❌ Gagal menghapus user dari role ${role}.`,
      });
    }
  }

  private async showHelp(sock: WebSocketInfo, chatId: string): Promise<void> {
    const helpText = `
🛠️ *Config Command Help*

*Melihat Konfigurasi:*
• \`config get\` - Lihat semua konfigurasi
• \`config get <parameter>\` - Lihat konfigurasi tertentu

*Mengubah Konfigurasi:*
• \`config set prefix <value>\` - Ubah prefix bot
• \`config set name <value>\` - Ubah nama bot
• \`config set maxsessions <number>\` - Ubah max sessions
• \`config set sessiontimeout <ms>\` - Ubah timeout session
• \`config set allowfromme <true/false>\` - Izinkan command dari bot
• \`config set defaultgamehelp <text>\` - Ubah pesan help game
• \`config set unknowncommandresponse <text>\` - Ubah pesan command tidak dikenal

*Mengelola User Roles:*
• \`config add-admin <user_jid>\` - Tambah admin
• \`config remove-admin <user_jid>\` - Hapus admin
• \`config add-mod <user_jid>\` - Tambah moderator
• \`config remove-mod <user_jid>\` - Hapus moderator
• \`config add-vip <user_jid>\` - Tambah VIP
• \`config remove-vip <user_jid>\` - Hapus VIP

*Lainnya:*
• \`config reset\` - Reset ke pengaturan default
    `.trim();

    await sock.sendMessage(chatId, { text: helpText });
  }
}
