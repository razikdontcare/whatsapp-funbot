import {Collection, MongoClient} from 'mongodb';
import {BotConfig} from '../../infrastructure/config/config.js';
import {getActiveMongoClient} from '../../infrastructure/config/mongo.js';

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
    private dbName: string;
    private collectionName: string;

    private get collection(): Collection<GameStat> {
        return getActiveMongoClient().db(this.dbName).collection<GameStat>(this.collectionName);
    }

    constructor(_mongoClient: MongoClient, dbName = BotConfig.sessionName, collectionName = 'game_leaderboards') {
        this.dbName = dbName;
        this.collectionName = collectionName;
    }

    async getUserStat(user: string, game: string): Promise<GameStat | null> {
        return this.collection.findOne({user, game});
    }

    async updateUserStat(user: string, game: string, data: Partial<GameStat>): Promise<void> {
        await this.collection.updateOne({user, game}, {$set: {...data, lastPlayed: new Date()}}, {upsert: true});
    }

    async getLeaderboard(game: string, limit = 10): Promise<GameStat[]> {
        return this.collection.find({game}).sort({score: -1, wins: -1}).limit(limit).toArray();
    }
}
