import { MongoClient, Collection, Document } from "mongodb";
import { BotConfig } from "../core/config.js";

export interface CommandUsage {
  command: string;
  user: string;
  count: number;
  lastUsed: Date;
}

export class CommandUsageService {
  private collection: Collection<CommandUsage>;

  constructor(
    mongoClient: MongoClient,
    dbName = BotConfig.sessionName,
    collectionName = "command_usage"
  ) {
    this.collection = mongoClient.db(dbName).collection(collectionName);
  }

  async increment(command: string, user: string): Promise<void> {
    await this.collection.updateOne(
      { command, user },
      { $inc: { count: 1 }, $set: { lastUsed: new Date() } },
      { upsert: true }
    );
  }

  async getCommandStats(command: string): Promise<CommandUsage[]> {
    return this.collection.find({ command }).toArray();
  }

  async getAllStats(): Promise<CommandUsage[]> {
    return this.collection.find({}).toArray();
  }
}
