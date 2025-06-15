import { getMongoClient } from "../core/mongo.js";
import { Collection, Db } from "mongodb";
import { BotConfig, log } from "../core/config.js";

export interface AIMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface AIConversationSession {
  userId: string;
  messages: AIMessage[];
  lastActivity: number;
  createdAt: number;
  expiresAt: number;
}

export class AIConversationService {
  private static instance: AIConversationService | null = null;
  private sessions: Map<string, AIConversationSession> = new Map();
  private db: Db | null = null;
  private conversationCollection: Collection | null = null;
  private initialized: boolean = false;
  private cleanupInterval: NodeJS.Timeout | null = null;

  private static readonly SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

  private constructor() {
    this.initialize();
  }

  static getInstance(): AIConversationService {
    if (!AIConversationService.instance) {
      AIConversationService.instance = new AIConversationService();
    }
    return AIConversationService.instance;
  }

  static async destroyInstance(): Promise<void> {
    if (AIConversationService.instance) {
      AIConversationService.instance.destroy();
      AIConversationService.instance = null;
    }
  }

  private async initialize(): Promise<void> {
    try {
      const client = await getMongoClient();
      this.db = client.db(
        process.env.NODE_ENV === "production"
          ? BotConfig.sessionName
          : `${BotConfig.sessionName}_dev`
      );
      this.conversationCollection = this.db.collection("ai_conversations");

      // Create index for automatic expiration
      await this.conversationCollection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 }
      );

      await this.loadSessionsFromDB();
      this.startCleanupInterval();
      this.initialized = true;
      log.info("AIConversationService initialized with MongoDB");
    } catch (error) {
      log.error("Failed to initialize MongoDB for AI conversations:", error);
      this.initialized = true;
    }
  }

  private async ensureInitialized(): Promise<boolean> {
    if (!this.initialized) {
      let attempts = 0;
      while (!this.initialized && attempts < 5) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        attempts++;
      }
    }
    return this.conversationCollection !== null;
  }

  private async loadSessionsFromDB(): Promise<void> {
    if (!this.conversationCollection) return;

    try {
      const now = Date.now();
      const activeSessions = await this.conversationCollection
        .find({ expiresAt: { $gt: new Date(now) } })
        .toArray();

      for (const session of activeSessions) {
        this.sessions.set(session.userId, {
          userId: session.userId,
          messages: session.messages,
          lastActivity: session.lastActivity,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        });
      }

      log.info(
        `Loaded ${activeSessions.length} active AI conversation sessions`
      );
    } catch (error) {
      log.error("Error loading AI conversation sessions from DB:", error);
    }
  }

  private startCleanupInterval(): void {
    // Clean up expired sessions every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000);
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [userId, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        expiredSessions.push(userId);
      }
    }

    for (const userId of expiredSessions) {
      this.sessions.delete(userId);
    }

    if (expiredSessions.length > 0) {
      log.info(
        `Cleaned up ${expiredSessions.length} expired AI conversation sessions`
      );
    }
  }

  async createSession(userId: string): Promise<AIConversationSession> {
    const now = Date.now();
    const session: AIConversationSession = {
      userId,
      messages: [],
      lastActivity: now,
      createdAt: now,
      expiresAt: now + AIConversationService.SESSION_TIMEOUT,
    };

    this.sessions.set(userId, session);

    if (await this.ensureInitialized()) {
      try {
        await this.conversationCollection!.replaceOne(
          { userId },
          { ...session, expiresAt: new Date(session.expiresAt) },
          { upsert: true }
        );
      } catch (error) {
        log.error("Error saving AI conversation session to DB:", error);
      }
    }

    return session;
  }

  async getSession(userId: string): Promise<AIConversationSession | null> {
    const session = this.sessions.get(userId);
    if (!session) return null;

    const now = Date.now();
    if (session.expiresAt < now) {
      // Session expired, remove it
      await this.endSession(userId);
      return null;
    }

    return session;
  }

  async addMessage(
    userId: string,
    role: "user" | "assistant",
    content: string
  ): Promise<void> {
    let session = await this.getSession(userId);
    if (!session) {
      session = await this.createSession(userId);
    }

    const now = Date.now();
    const message: AIMessage = {
      role,
      content,
      timestamp: now,
    };

    session.messages.push(message);
    session.lastActivity = now;
    session.expiresAt = now + AIConversationService.SESSION_TIMEOUT;

    if (await this.ensureInitialized()) {
      try {
        await this.conversationCollection!.replaceOne(
          { userId },
          { ...session, expiresAt: new Date(session.expiresAt) },
          { upsert: true }
        );
      } catch (error) {
        log.error("Error updating AI conversation session in DB:", error);
      }
    }
  }

  async endSession(userId: string): Promise<boolean> {
    const hadSession = this.sessions.has(userId);
    this.sessions.delete(userId);

    if (await this.ensureInitialized()) {
      try {
        await this.conversationCollection!.deleteOne({ userId });
      } catch (error) {
        log.error("Error deleting AI conversation session from DB:", error);
      }
    }

    return hadSession;
  }

  async getConversationHistory(userId: string): Promise<AIMessage[]> {
    const session = await this.getSession(userId);
    return session ? session.messages : [];
  }

  hasActiveSession(userId: string): boolean {
    const session = this.sessions.get(userId);
    if (!session) return false;

    const now = Date.now();
    return session.expiresAt > now;
  }

  getSessionInfo(userId: string): {
    hasSession: boolean;
    messageCount: number;
    timeRemaining: number;
  } {
    const session = this.sessions.get(userId);
    if (!session) {
      return { hasSession: false, messageCount: 0, timeRemaining: 0 };
    }

    const now = Date.now();
    const timeRemaining = Math.max(0, session.expiresAt - now);

    return {
      hasSession: timeRemaining > 0,
      messageCount: session.messages.length,
      timeRemaining,
    };
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
