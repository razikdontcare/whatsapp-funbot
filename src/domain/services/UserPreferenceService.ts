import { Collection, MongoClient } from "mongodb";
import { BotConfig } from "../../infrastructure/config/config.js";
import type { AIProviderPreference } from "../../infrastructure/config/config.js";
import {
  resolveAIPersonality,
  type AIPersonality,
} from "../../shared/utils/promptLoader.js";
import { getActiveMongoClient } from "../../infrastructure/config/mongo.js";

export interface UserPreference {
  user: string; // WhatsApp JID
  language?: string;
  nickname?: string;
  notifications?: boolean;
  customAliases?: Record<string, string>;
  aiProviderPreference?: AIProviderPreference;
  aiPersonalityPreference?: AIPersonality;
  stickerAuthor?: string;
  stickerPack?: string;
  traits?: Record<string, string>; // User profile traits graph
}

export class UserPreferenceService {
  private dbName: string;
  private collectionName: string;

  private get collection(): Collection<UserPreference> {
    return getActiveMongoClient().db(this.dbName).collection<UserPreference>(this.collectionName);
  }

  constructor(
    _mongoClient: MongoClient,
    dbName = BotConfig.sessionName,
    collectionName = "user_preferences",
  ) {
    this.dbName = dbName;
    this.collectionName = collectionName;
  }

  async get(user: string): Promise<UserPreference | null> {
    return this.collection.findOne({ user });
  }

  async set(user: string, data: Partial<UserPreference>): Promise<void> {
    await this.collection.updateOne({ user }, { $set: data }, { upsert: true });
  }

  async getProfileGraph(user: string): Promise<Record<string, string>> {
    const preference = await this.get(user);
    return preference?.traits || {};
  }

  async updateProfileTrait(
    user: string,
    key: string,
    value: string,
  ): Promise<void> {
    const field = `traits.${key}`;
    await this.collection.updateOne(
      { user },
      { $set: { [field]: value } },
      { upsert: true },
    );
  }

  async deleteProfileTrait(user: string, key: string): Promise<void> {
    const field = `traits.${key}`;
    await this.collection.updateOne(
      { user },
      { $unset: { [field]: "" } },
    );
  }

  async getAIProviderPreference(
    user: string,
  ): Promise<AIProviderPreference | null> {
    const preference = await this.get(user);
    const value = preference?.aiProviderPreference;

    if (
      value === "groq" ||
      value === "google" ||
      value === "openrouter" ||
      value === "deepseek" ||
      value === "auto"
    ) {
      return value;
    }

    return null;
  }

  async setAIProviderPreference(
    user: string,
    provider: AIProviderPreference,
  ): Promise<void> {
    await this.set(user, { aiProviderPreference: provider });
  }

  async clearAIProviderPreference(user: string): Promise<void> {
    await this.collection.updateOne(
      { user },
      { $unset: { aiProviderPreference: "" } },
    );
  }

  async getAIPersonalityPreference(
    user: string,
  ): Promise<AIPersonality | null> {
    const preference = await this.get(user);
    const storedPreference = preference?.aiPersonalityPreference || null;
    const resolvedPreference = resolveAIPersonality(storedPreference);

    if (storedPreference && !resolvedPreference) {
      await this.clearAIPersonalityPreference(user);
      return null;
    }

    return resolvedPreference;
  }

  async setAIPersonalityPreference(
    user: string,
    personality: AIPersonality,
  ): Promise<void> {
    await this.set(user, { aiPersonalityPreference: personality });
  }

  async clearAIPersonalityPreference(user: string): Promise<void> {
    await this.collection.updateOne(
      { user },
      { $unset: { aiPersonalityPreference: "" } },
    );
  }
}
