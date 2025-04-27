import { BotConfig, log } from "../core/config.js";
import { Session } from "../core/types.js";
import { getMongoClient } from "../core/mongo.js";
import { Collection, Db } from "mongodb";

export class SessionService {
  private sessions: Map<string, Map<string, Session>> = new Map();
  private db: Db | null = null;
  private sessionCollection: Collection | null = null;
  private initialized: boolean = false;

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      const client = await getMongoClient();
      this.db = client.db(
        process.env.NODE_ENV === "production"
          ? BotConfig.sessionName
          : `${BotConfig.sessionName}_dev`
      );
      this.sessionCollection = this.db.collection("sessions");
      await this.loadSessionsFromDB();
      this.initialized = true;
      log.info(
        "SessionService initialized with MongoDB on " + this.db.databaseName
      );
    } catch (error) {
      log.error("Failed to initialize MongoDB for sessions:", error);
      // Fallback to in-memory only
      this.initialized = true;
    }
  }

  private async ensureInitialized(): Promise<boolean> {
    if (!this.initialized) {
      // Wait for initialization to complete if it's in progress
      let attempts = 0;
      while (!this.initialized && attempts < 5) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        attempts++;
      }
    }
    return this.sessionCollection !== null;
  }

  private async loadSessionsFromDB(): Promise<void> {
    if (!this.sessionCollection) return;

    try {
      const storedSessions = await this.sessionCollection.find({}).toArray();

      for (const storedSession of storedSessions) {
        const { jid, user, game, data, timestamp } = storedSession;

        let userSessions = this.sessions.get(jid);
        if (!userSessions) {
          userSessions = new Map();
          this.sessions.set(jid, userSessions);
        }

        userSessions.set(user, {
          game,
          data,
          timestamp,
        });
      }

      log.info(`Loaded ${storedSessions.length} sessions from MongoDB`);
    } catch (error) {
      log.error("Error loading sessions from MongoDB:", error);
    }
  }

  private async saveSessionToDB(
    jid: string,
    user: string,
    session: Session
  ): Promise<void> {
    if (!(await this.ensureInitialized()) || !this.sessionCollection) return;

    try {
      await this.sessionCollection.updateOne(
        { jid, user },
        {
          $set: {
            jid,
            user,
            game: session.game,
            data: session.data,
            timestamp: session.timestamp,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      log.error("Error saving session to MongoDB:", error);
    }
  }

  private async removeSessionFromDB(jid: string, user: string): Promise<void> {
    if (!(await this.ensureInitialized()) || !this.sessionCollection) return;

    try {
      await this.sessionCollection.deleteOne({ jid, user });
    } catch (error) {
      log.error("Error removing session from MongoDB:", error);
    }
  }

  async getSession<T>(jid: string, user: string): Promise<Session<T> | null> {
    await this.ensureInitialized();

    try {
      const userSessions = this.sessions.get(jid);
      if (!userSessions) return null;

      const session = userSessions.get(user);
      if (!session) return null;

      // timeout 1 jam (1 hour)
      if (Date.now() - session.timestamp > 3600000) {
        this.clearSession(jid, user);
        return null;
      }

      return session as Session<T>;
    } catch (error) {
      log.error("Error getting session:", error);
      return null;
    }
  }

  async getAllSessionsInChat<T>(jid: string): Promise<Session<T>[]> {
    await this.ensureInitialized();

    try {
      const userSessions = this.sessions.get(jid);
      if (!userSessions) return [];

      const result: Session<T>[] = [];
      const now = Date.now();

      userSessions.forEach((session, user) => {
        if (now - session.timestamp <= 3600000) {
          result.push(session as Session<T>);
        } else {
          // Remove expired sessions
          this.clearSession(jid, user);
        }
      });

      return result;
    } catch (error) {
      log.error("Error getting all sessions in chat:", error);
      return [];
    }
  }

  private checkSessionLimit(jid: string): boolean {
    const userSessions = this.sessions.get(jid);
    if (userSessions && userSessions.size >= BotConfig.maxSessions) {
      return false;
    }
    return true;
  }

  async setSession<T>(
    jid: string,
    user: string,
    game: string,
    data: T
  ): Promise<boolean> {
    await this.ensureInitialized();

    if (!this.checkSessionLimit(jid)) {
      return false;
    }

    try {
      let userSessions = this.sessions.get(jid);
      if (!userSessions) {
        userSessions = new Map();
        this.sessions.set(jid, userSessions);
      }

      const session = {
        game,
        data,
        timestamp: Date.now(),
      };

      userSessions.set(user, session);

      // Save to MongoDB
      await this.saveSessionToDB(jid, user, session);

      return true;
    } catch (error) {
      log.error("Error setting session:", error);
      return false;
    }
  }

  async clearSession(jid: string, user: string): Promise<void> {
    await this.ensureInitialized();

    try {
      const userSessions = this.sessions.get(jid);
      if (userSessions) {
        userSessions.delete(user);

        if (userSessions.size === 0) {
          this.sessions.delete(jid);
        }

        // Remove from MongoDB
        await this.removeSessionFromDB(jid, user);
      }
    } catch (error) {
      log.error("Error clearing session:", error);
    }
  }

  async cleanupExpiredSessions(): Promise<void> {
    await this.ensureInitialized();

    const now = Date.now();
    const expiredSessions: { jid: string; user: string }[] = [];

    this.sessions.forEach((userSessions, jid) => {
      userSessions.forEach((session, user) => {
        if (now - session.timestamp > 3600000) {
          userSessions.delete(user);
          expiredSessions.push({ jid, user });
        }
      });

      if (userSessions.size === 0) {
        this.sessions.delete(jid);
      }
    });

    // Bulk remove expired sessions from MongoDB
    if (this.sessionCollection && expiredSessions.length > 0) {
      try {
        const deleteOperations = expiredSessions.map(({ jid, user }) => ({
          deleteOne: { filter: { jid, user } },
        }));

        if (deleteOperations.length > 0) {
          await this.sessionCollection.bulkWrite(deleteOperations);
          log.info(`Cleaned up ${deleteOperations.length} expired sessions`);
        }
      } catch (error) {
        log.error("Error bulk removing expired sessions from MongoDB:", error);
      }
    }
  }

  async getAllChatIds(): Promise<string[]> {
    await this.ensureInitialized();

    try {
      return Array.from(this.sessions.keys());
    } catch (error) {
      log.error("Error getting all chat IDs:", error);
      return [];
    }
  }
}
