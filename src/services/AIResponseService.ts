import { getMongoClient } from "../core/mongo.js";
import { Collection, Db } from "mongodb";
import { BotConfig, log } from "../core/config.js";

export interface AIGroupResponse {
  responseId: string;
  groupId: string;
  userId: string;
  userPushName?: string;
  userQuestion: string;
  aiResponse: string;
  timestamp: number;
  expiresAt: number;
}

export class AIResponseService {
  private static instance: AIResponseService | null = null;
  private db: Db | null = null;
  private responsesCollection: Collection | null = null;
  private initialized: boolean = false;
  private cleanupInterval: NodeJS.Timeout | null = null;

  private static readonly RESPONSE_RETENTION_TIME = 10 * 60 * 1000; // 10 minutes

  private constructor() {
    this.initialize();
  }

  static getInstance(): AIResponseService {
    if (!AIResponseService.instance) {
      AIResponseService.instance = new AIResponseService();
    }
    return AIResponseService.instance;
  }

  static async destroyInstance(): Promise<void> {
    if (AIResponseService.instance) {
      AIResponseService.instance.destroy();
      AIResponseService.instance = null;
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
      this.responsesCollection = this.db.collection("ai_group_responses");

      // Create indexes
      await this.responsesCollection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 }
      );
      await this.responsesCollection.createIndex({ groupId: 1, timestamp: -1 });
      await this.responsesCollection.createIndex(
        { responseId: 1 },
        { unique: true }
      );

      this.startCleanupInterval();
      this.initialized = true;
      log.info("AIResponseService initialized with MongoDB");
    } catch (error) {
      log.error("Failed to initialize MongoDB for AI responses:", error);
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
    return this.responsesCollection !== null;
  }

  private startCleanupInterval(): void {
    // Clean up old responses every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldResponses();
    }, 60 * 60 * 1000);
  }

  private async cleanupOldResponses(): Promise<void> {
    if (!this.responsesCollection) return;

    try {
      const now = Date.now();
      const result = await this.responsesCollection.deleteMany({
        expiresAt: { $lt: new Date(now) },
      });

      if (result.deletedCount > 0) {
        log.info(`Cleaned up ${result.deletedCount} old AI responses`);
      }
    } catch (error) {
      log.error("Error cleaning up old AI responses:", error);
    }
  }

  async saveResponse(
    groupId: string,
    userId: string,
    userPushName: string | undefined,
    userQuestion: string,
    aiResponse: string
  ): Promise<string> {
    if (!(await this.ensureInitialized())) {
      throw new Error("AIResponseService not initialized");
    }

    const now = Date.now();
    const responseId = `${groupId}_${userId}_${now}`;

    const response: AIGroupResponse = {
      responseId,
      groupId,
      userId,
      userPushName,
      userQuestion,
      aiResponse,
      timestamp: now,
      expiresAt: now + AIResponseService.RESPONSE_RETENTION_TIME,
    };

    try {
      await this.responsesCollection!.insertOne({
        ...response,
        expiresAt: new Date(response.expiresAt),
      });

      log.info(`Saved AI response for group ${groupId} by user ${userId}`);
      return responseId;
    } catch (error) {
      log.error("Error saving AI response:", error);
      throw error;
    }
  }

  async getGroupResponses(
    groupId: string,
    limit: number = 20
  ): Promise<AIGroupResponse[]> {
    if (!(await this.ensureInitialized())) {
      return [];
    }

    try {
      const responses = await this.responsesCollection!.find({ groupId })
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();

      return responses.map((response) => ({
        responseId: response.responseId,
        groupId: response.groupId,
        userId: response.userId,
        userPushName: response.userPushName,
        userQuestion: response.userQuestion,
        aiResponse: response.aiResponse,
        timestamp: response.timestamp,
        expiresAt: response.expiresAt.getTime
          ? response.expiresAt.getTime()
          : response.expiresAt,
      }));
    } catch (error) {
      log.error("Error fetching group responses:", error);
      return [];
    }
  }

  async getResponseById(responseId: string): Promise<AIGroupResponse | null> {
    if (!(await this.ensureInitialized())) {
      return null;
    }

    try {
      const response = await this.responsesCollection!.findOne({ responseId });
      if (!response) return null;

      return {
        responseId: response.responseId,
        groupId: response.groupId,
        userId: response.userId,
        userPushName: response.userPushName,
        userQuestion: response.userQuestion,
        aiResponse: response.aiResponse,
        timestamp: response.timestamp,
        expiresAt: response.expiresAt.getTime
          ? response.expiresAt.getTime()
          : response.expiresAt,
      };
    } catch (error) {
      log.error("Error fetching response by ID:", error);
      return null;
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
