import { MongoClient, Collection } from "mongodb";
import { BotConfig, UserRole } from "../core/config.js";
import { log } from "../core/config.js";

export interface StoredBotConfig {
  _id: string;
  // UI Settings
  prefix?: string;
  alternativePrefixes?: string[];
  allowMentionPrefix?: boolean;

  // General Settings
  name?: string;
  maxSessions?: number;
  sessionTimeout?: number;
  allowFromMe?: boolean;
  disableWarning?: boolean; // Disable warning to users when using commands

  // Game Settings
  defaultGameHelp?: string;
  unknownCommandResponse?: string;

  // Emoji Settings
  emoji?: {
    games?: string;
    help?: string;
    error?: string;
    success?: string;
    info?: string;
    hangman?: string;
    rps?: string;
  };

  // Messages
  messages?: {
    sessionTimeout?: string;
    gameInProgress?: string;
    gameNotFound?: string;
    gameStopped?: string;
    noGameRunning?: string;
    commandError?: string;
  };

  // User Roles (non-sensitive data)
  admins?: string[];
  moderators?: string[];
  vips?: string[];

  // Metadata
  lastUpdated?: Date;
  updatedBy?: string;
}

export class BotConfigService {
  private collection: Collection<StoredBotConfig>;
  private cachedConfig: StoredBotConfig | null = null;
  private lastCacheUpdate: number = 0;
  private readonly CACHE_TTL = 60000; // 1 minute cache TTL

  constructor(
    mongoClient: MongoClient,
    dbName = BotConfig.sessionName,
    collectionName = "bot_config"
  ) {
    this.collection = mongoClient.db(dbName).collection(collectionName);
  }

  /**
   * Get the current bot configuration from database with fallback to default
   */
  async getConfig(): Promise<StoredBotConfig> {
    // Check cache first
    if (
      this.cachedConfig &&
      Date.now() - this.lastCacheUpdate < this.CACHE_TTL
    ) {
      return this.cachedConfig;
    }

    try {
      const storedConfig = await this.collection.findOne({ _id: "default" });

      if (!storedConfig) {
        // No config in database, create default one
        const defaultConfig = this.createDefaultConfig();
        await this.collection.insertOne(defaultConfig);
        this.cachedConfig = defaultConfig;
      } else {
        this.cachedConfig = storedConfig;
      }

      this.lastCacheUpdate = Date.now();
      return this.cachedConfig!;
    } catch (error) {
      log.error("Error getting bot config from database:", error);
      // Return default config if database fails
      return this.createDefaultConfig();
    }
  }

  /**
   * Update bot configuration in database
   */
  async updateConfig(
    updates: Partial<StoredBotConfig>,
    updatedBy?: string
  ): Promise<boolean> {
    try {
      const updateData: Partial<StoredBotConfig> = {
        ...updates,
        lastUpdated: new Date(),
        updatedBy: updatedBy || "system",
      };

      await this.collection.updateOne(
        { _id: "default" },
        { $set: updateData },
        { upsert: true }
      );

      // Invalidate cache
      this.cachedConfig = null;
      this.lastCacheUpdate = 0;

      log.info(`Bot configuration updated by ${updatedBy || "system"}`);
      return true;
    } catch (error) {
      log.error("Error updating bot config:", error);
      return false;
    }
  }

  /**
   * Get merged configuration (database + environment variables)
   */
  async getMergedConfig(): Promise<typeof BotConfig> {
    const storedConfig = await this.getConfig();

    // Merge stored config with default config, keeping environment variables
    return {
      // Default values from BotConfig (including sensitive env vars)
      ...BotConfig,

      // Override with database values
      prefix: storedConfig.prefix ?? BotConfig.prefix,
      alternativePrefixes:
        storedConfig.alternativePrefixes ?? BotConfig.alternativePrefixes,
      allowMentionPrefix:
        storedConfig.allowMentionPrefix ?? BotConfig.allowMentionPrefix,
      name: storedConfig.name ?? BotConfig.name,
      maxSessions: storedConfig.maxSessions ?? BotConfig.maxSessions,
      sessionTimeout: storedConfig.sessionTimeout ?? BotConfig.sessionTimeout,
      allowFromMe: storedConfig.allowFromMe ?? BotConfig.allowFromMe,
      disableWarning: storedConfig.disableWarning ?? BotConfig.disableWarning,
      defaultGameHelp:
        storedConfig.defaultGameHelp ?? BotConfig.defaultGameHelp,
      unknownCommandResponse:
        storedConfig.unknownCommandResponse ?? BotConfig.unknownCommandResponse,
      emoji: {
        ...BotConfig.emoji,
        ...storedConfig.emoji,
      },
      messages: {
        ...BotConfig.messages,
        ...storedConfig.messages,
      },
      admins: storedConfig.admins ?? BotConfig.admins,
      moderators: storedConfig.moderators ?? BotConfig.moderators,
      vips: storedConfig.vips ?? BotConfig.vips,
    };
  }

  /**
   * Reset configuration to defaults
   */
  async resetToDefaults(updatedBy?: string): Promise<boolean> {
    try {
      const defaultConfig = this.createDefaultConfig();
      defaultConfig.lastUpdated = new Date();
      defaultConfig.updatedBy = updatedBy || "system";

      await this.collection.replaceOne({ _id: "default" }, defaultConfig, {
        upsert: true,
      });

      // Invalidate cache
      this.cachedConfig = null;
      this.lastCacheUpdate = 0;

      log.info(
        `Bot configuration reset to defaults by ${updatedBy || "system"}`
      );
      return true;
    } catch (error) {
      log.error("Error resetting bot config:", error);
      return false;
    }
  }

  /**
   * Add user to role
   */
  async addUserToRole(
    userJid: string,
    role: UserRole,
    updatedBy?: string
  ): Promise<boolean> {
    try {
      const roleField = `${role}s` as keyof Pick<
        StoredBotConfig,
        "admins" | "moderators" | "vips"
      >;

      await this.collection.updateOne(
        { _id: "default" },
        {
          $addToSet: { [roleField]: userJid },
          $set: {
            lastUpdated: new Date(),
            updatedBy: updatedBy || "system",
          },
        },
        { upsert: true }
      );

      // Invalidate cache
      this.cachedConfig = null;
      this.lastCacheUpdate = 0;

      log.info(
        `User ${userJid} added to ${role} role by ${updatedBy || "system"}`
      );
      return true;
    } catch (error) {
      log.error(`Error adding user to ${role} role:`, error);
      return false;
    }
  }

  /**
   * Remove user from role
   */
  async removeUserFromRole(
    userJid: string,
    role: UserRole,
    updatedBy?: string
  ): Promise<boolean> {
    try {
      const roleField = `${role}s` as keyof Pick<
        StoredBotConfig,
        "admins" | "moderators" | "vips"
      >;

      await this.collection.updateOne(
        { _id: "default" },
        {
          $pull: { [roleField]: userJid },
          $set: {
            lastUpdated: new Date(),
            updatedBy: updatedBy || "system",
          },
        }
      );

      // Invalidate cache
      this.cachedConfig = null;
      this.lastCacheUpdate = 0;

      log.info(
        `User ${userJid} removed from ${role} role by ${updatedBy || "system"}`
      );
      return true;
    } catch (error) {
      log.error(`Error removing user from ${role} role:`, error);
      return false;
    }
  }

  /**
   * Get configuration history (if you want to track changes)
   */
  async getConfigHistory(limit: number = 10): Promise<StoredBotConfig[]> {
    try {
      return await this.collection
        .find({})
        .sort({ lastUpdated: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      log.error("Error getting config history:", error);
      return [];
    }
  }

  /**
   * Create default configuration object
   */
  private createDefaultConfig(): StoredBotConfig {
    return {
      _id: "default",
      prefix: BotConfig.prefix,
      alternativePrefixes: BotConfig.alternativePrefixes,
      allowMentionPrefix: BotConfig.allowMentionPrefix,
      name: BotConfig.name,
      maxSessions: BotConfig.maxSessions,
      sessionTimeout: BotConfig.sessionTimeout,
      allowFromMe: BotConfig.allowFromMe,
      disableWarning: BotConfig.disableWarning,
      defaultGameHelp: BotConfig.defaultGameHelp,
      unknownCommandResponse: BotConfig.unknownCommandResponse,
      emoji: BotConfig.emoji,
      messages: BotConfig.messages,
      admins: BotConfig.admins,
      moderators: BotConfig.moderators,
      vips: BotConfig.vips,
      lastUpdated: new Date(),
      updatedBy: "system",
    };
  }

  /**
   * Invalidate cache manually
   */
  invalidateCache(): void {
    this.cachedConfig = null;
    this.lastCacheUpdate = 0;
  }
}
