import { Collection, MongoClient } from "mongodb";
import { BotConfig } from "../../infrastructure/config/config.js";
import { getActiveMongoClient } from "../../infrastructure/config/mongo.js";

export interface GroupSetting {
  group: string; // WhatsApp group JID
  prefix?: string;
  enabledCommands?: string[];
  welcomeMessage?: string;
  adminOnly?: boolean;
  freeGamesEnabled?: boolean;
  freeGamesEnabledAt?: Date;
  freeGamesEnabledBy?: string;
}

export class GroupSettingService {
  private dbName: string;
  private collectionName: string;

  private get collection(): Collection<GroupSetting> {
    return getActiveMongoClient().db(this.dbName).collection<GroupSetting>(this.collectionName);
  }

  constructor(
    _mongoClient: MongoClient,
    dbName = BotConfig.sessionName,
    collectionName = "group_settings",
  ) {
    this.dbName = dbName;
    this.collectionName = collectionName;
  }

  async get(group: string): Promise<GroupSetting | null> {
    return this.collection.findOne({ group });
  }

  async set(group: string, data: Partial<GroupSetting>): Promise<void> {
    await this.collection.updateOne(
      { group },
      { $set: { group, ...data } },
      { upsert: true },
    );
  }

  async setFreeGamesEnabled(
    group: string,
    enabled: boolean,
    by?: string,
  ): Promise<void> {
    if (enabled) {
      await this.set(group, {
        freeGamesEnabled: true,
        freeGamesEnabledAt: new Date(),
        freeGamesEnabledBy: by,
      });
      return;
    }

    await this.set(group, {
      freeGamesEnabled: false,
    });
  }

  async getFreeGamesEnabledGroups(): Promise<string[]> {
    const groups = await this.collection
      .find({ freeGamesEnabled: true })
      .project({ group: 1 })
      .toArray();
    return groups.map((item) => item.group);
  }
}
