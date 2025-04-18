import { MongoClient, Collection } from "mongodb";

export interface GameStat {
  user: string; // WhatsApp JID
  game: string; // e.g., "hangman", "rps"
  wins?: number;
  losses?: number;
  draws?: number;
  score?: number;
  lastPlayed?: Date;
}

export class GameLeaderboardService {
  private collection: Collection<GameStat>;

  constructor(
    mongoClient: MongoClient,
    dbName = "whatsapp_funbot",
    collectionName = "game_leaderboards"
  ) {
    this.collection = mongoClient.db(dbName).collection(collectionName);
  }

  async getUserStat(user: string, game: string): Promise<GameStat | null> {
    return this.collection.findOne({ user, game });
  }

  async updateUserStat(
    user: string,
    game: string,
    data: Partial<GameStat>
  ): Promise<void> {
    await this.collection.updateOne(
      { user, game },
      { $set: { ...data, lastPlayed: new Date() } },
      { upsert: true }
    );
  }

  async getLeaderboard(game: string, limit = 10): Promise<GameStat[]> {
    return this.collection
      .find({ game })
      .sort({ score: -1, wins: -1 })
      .limit(limit)
      .toArray();
  }
}
