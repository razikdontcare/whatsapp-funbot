import { MongoClient, Collection } from "mongodb";
import { BotConfig } from "../core/config.js";

export interface UserPreference {
  user: string; // WhatsApp JID
  language?: string;
  nickname?: string;
  notifications?: boolean;
  customAliases?: Record<string, string>;
}

export class UserPreferenceService {
  private collection: Collection<UserPreference>;

  constructor(
    mongoClient: MongoClient,
    dbName = BotConfig.sessionName,
    collectionName = "user_preferences"
  ) {
    this.collection = mongoClient.db(dbName).collection(collectionName);
  }

  async get(user: string): Promise<UserPreference | null> {
    return this.collection.findOne({ user });
  }

  async set(user: string, data: Partial<UserPreference>): Promise<void> {
    await this.collection.updateOne({ user }, { $set: data }, { upsert: true });
  }
}
