import { MongoClient, Collection } from "mongodb";

export interface GroupSetting {
  group: string; // WhatsApp group JID
  prefix?: string;
  enabledCommands?: string[];
  welcomeMessage?: string;
  adminOnly?: boolean;
}

export class GroupSettingService {
  private collection: Collection<GroupSetting>;

  constructor(
    mongoClient: MongoClient,
    dbName = "whatsapp_funbot",
    collectionName = "group_settings"
  ) {
    this.collection = mongoClient.db(dbName).collection(collectionName);
  }

  async get(group: string): Promise<GroupSetting | null> {
    return this.collection.findOne({ group });
  }

  async set(group: string, data: Partial<GroupSetting>): Promise<void> {
    await this.collection.updateOne(
      { group },
      { $set: data },
      { upsert: true }
    );
  }
}
