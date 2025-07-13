import { config } from "dotenv";
config(); // Load environment variables from .env file
import { Logger } from "../utils/logger.js";
import { BotConfigService } from "../services/BotConfigService.js";
import { getMongoClient } from "./mongo.js";

// Define all possible roles here
export type UserRole = "admin" | "moderator" | "vip";

// Default configuration - sensitive data remains in environment variables
export const BotConfig = {
  // Pengaturan Prefix
  prefix: "!",
  alternativePrefixes: ["/"],
  allowMentionPrefix: false, // Aktifkan untuk mengizinkan prefix mention (@bot command)

  // Pengaturan Umum
  name: "MeoW",
  maxSessions: 5, // Maksimal session per user
  sessionTimeout: 3600000, // Waktu timeout session dalam milidetik (1 jam)
  sessionName: "meowbot", // Nama session untuk penyimpanan (hindari spasi dan karakter khusus)
  allowFromMe: false, // Izinkan bot untuk handle command dari dirinya sendiri
  disableWarning: false, // Nonaktifkan peringatan ke pengguna saat penggunaan command

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

  // Pengaturan API (tetap di environment variables untuk keamanan)
  groqApiKey: process.env.GROQ_API_KEY || "", // Kunci API untuk Groq AI

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

// Singleton instance for dynamic configuration
let configService: BotConfigService | null = null;

/**
 * Get the BotConfigService instance (singleton)
 */
export async function getBotConfigService(): Promise<BotConfigService> {
  if (!configService) {
    const mongoClient = await getMongoClient();
    configService = new BotConfigService(mongoClient);
  }
  return configService;
}

/**
 * Get current bot configuration (merged from database + environment)
 */
export async function getCurrentConfig(): Promise<typeof BotConfig> {
  try {
    const service = await getBotConfigService();
    return await service.getMergedConfig();
  } catch (error) {
    log.error("Error getting current config, using defaults:", error);
    return BotConfig;
  }
}

/**
 * Get user roles from current configuration
 */
export async function getUserRoles(userJid: string): Promise<UserRole[]> {
  try {
    const config = await getCurrentConfig();
    const roles: UserRole[] = [];
    if (config.admins.includes(userJid)) roles.push("admin");
    if (config.moderators.includes(userJid)) roles.push("moderator");
    if (config.vips.includes(userJid)) roles.push("vip");
    return roles;
  } catch (error) {
    log.error("Error getting user roles:", error);
    // Fallback to default config
    const roles: UserRole[] = [];
    if (BotConfig.admins.includes(userJid)) roles.push("admin");
    if (BotConfig.moderators.includes(userJid)) roles.push("moderator");
    if (BotConfig.vips.includes(userJid)) roles.push("vip");
    return roles;
  }
}

/**
 * Synchronous version for backward compatibility (uses cached config)
 */
export function getUserRolesSync(userJid: string): UserRole[] {
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
