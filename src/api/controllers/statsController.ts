import { Context } from "hono";
import { getMongoClient } from "../../core/mongo.js";
import { CommandUsageService } from "../../services/CommandUsageService.js";
import { GameLeaderboardService } from "../../services/GameLeaderboardService.js";

export class StatsController {
  // Get all command usage stats
  static async getCommandUsage(c: Context) {
    try {
      const client = await getMongoClient();
      const usageService = new CommandUsageService(client);
      const stats = await usageService.getAllStats();
      return c.json(stats);
    } catch (err) {
      return c.json({ error: "Failed to fetch command usage stats" }, 500);
    }
  }

  // Get leaderboard for a game
  static async getLeaderboard(c: Context) {
    const game = c.req.query("game");
    if (!game) return c.json({ error: "Missing 'game' query param" }, 400);
    
    try {
      const client = await getMongoClient();
      const leaderboardService = new GameLeaderboardService(client);
      const leaderboard = await leaderboardService.getLeaderboard(game, 10);
      return c.json(leaderboard);
    } catch (err) {
      return c.json({ error: "Failed to fetch leaderboard" }, 500);
    }
  }
}