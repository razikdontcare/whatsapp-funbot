import { Logger } from "../utils/logger.js";

// Define all possible roles here
export type UserRole = "admin" | "moderator" | "vip";

export const BotConfig = {
  // Pengaturan Prefix
  prefix: "!",
  alternativePrefixes: ["/", "."],
  allowMentionPrefix: true, // Aktifkan untuk mengizinkan prefix mention (@bot command)

  // Pengaturan Umum
  name: "MeoW",
  maxSessions: 5, // Maksimal session per user
  sessionTimeout: 3600000, // Waktu timeout session dalam milidetik (1 jam)
  sessionName: "meowbot",
  allowFromMe: false, // Izinkan bot untuk handle command dari dirinya sendiri

  // Pengaturan Game
  defaultGameHelp: "Ketikan {prefix}games untuk melihat daftar game.",
  unknownCommandResponse:
    "Perintah tidak dikenali. Ketik {prefix}games untuk bantuan.",

  // Pengaturan UI
  emoji: {
    games: "🎮",
    help: "📋",
    error: "❌",
    success: "✅",
    info: "ℹ️",
    hangman: "👻",
    rps: "✂️",
  },

  // Pesan respons
  messages: {
    sessionTimeout: "Game telah berakhir karena tidak ada aktivitas.",
    gameInProgress:
      "Kamu sedang dalam game {game}. Akhiri dulu dengan {prefix}stop.",
    gameNotFound:
      "Game tidak ditemukan. Ketik {prefix}games untuk melihat daftar game.",
    gameStopped: "Game {game} telah dihentikan.",
    noGameRunning: "Tidak ada game yang sedang berjalan.",
    commandError: "Terjadi error saat memproses perintah. Silahkan coba lagi.",
  },

  // Admins: List of WhatsApp JIDs allowed to use admin commands
  admins: [] as string[],
  moderators: [] as string[],
  vips: [] as string[],
};

export function getUserRoles(userJid: string): UserRole[] {
  const roles: UserRole[] = [];
  if (BotConfig.admins.includes(userJid)) roles.push("admin");
  if (BotConfig.moderators.includes(userJid)) roles.push("moderator");
  if (BotConfig.vips.includes(userJid)) roles.push("vip");
  return roles;
}

export const log = new Logger({
  level: "debug",
  displayTimestamp: true,
  displayLevel: true,
});
