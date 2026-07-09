import { Collection, MongoClient } from 'mongodb';
import { BotConfig } from '../../infrastructure/config/config.js';
import { getActiveMongoClient } from '../../infrastructure/config/mongo.js';

export interface CommandUsage {
  command: string;
  user: string;
  count: number;
  lastUsed: Date;
}

export class CommandUsageService {
  private dbName: string;
  private collectionName: string;

  private get collection(): Collection<CommandUsage> {
    return getActiveMongoClient().db(this.dbName).collection<CommandUsage>(this.collectionName);
  }

  constructor(_mongoClient: MongoClient, dbName = BotConfig.sessionName, collectionName = 'command_usage') {
    this.dbName = dbName;
    this.collectionName = collectionName;
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
