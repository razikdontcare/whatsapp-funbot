import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { getMongoClient } from "./core/mongo.js";
import { CommandUsageService } from "./services/CommandUsageService.js";
import { GameLeaderboardService } from "./services/GameLeaderboardService.js";
import { BotClient } from "./core/BotClient.js";

const app = new Hono();

// REST API: Get all command usage stats
app.get("/api/command-usage", async (c) => {
  try {
    const client = await getMongoClient();
    const usageService = new CommandUsageService(client);
    const stats = await usageService.getAllStats();
    return c.json(stats);
  } catch (err) {
    return c.json({ error: "Failed to fetch command usage stats" }, 500);
  }
});

// REST API: Get leaderboard for a game (e.g. /api/leaderboard?game=hangman)
app.get("/api/leaderboard", async (c) => {
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
});

function getBotClient(): BotClient | null {
  // @ts-ignore
  return typeof globalThis.__botClient === "object"
    ? // @ts-ignore
      globalThis.__botClient
    : null;
}

// REST API: Send a WhatsApp message
app.post("/api/send-message", async (c) => {
  const { jid, text } = await c.req.json();
  if (!jid || !text) {
    return c.json({ error: "Missing 'jid' or 'text' in request body" }, 400);
  }
  try {
    const botClient = getBotClient();
    if (
      !botClient ||
      !(botClient as any)["sock"] ||
      !(botClient as any)["sock"]
    ) {
      return c.json({ error: "Bot is not ready or not connected" }, 503);
    }
    const sock = (botClient as any)["sock"];
    await sock.sendMessage(jid, { text });
    return c.json({ success: true });
  } catch (err) {
    return c.json(
      { error: "Failed to send message", details: String(err) },
      500
    );
  }
});

serve({
  fetch: app.fetch,
  port: process.env.DASHBOARD_PORT ? Number(process.env.DASHBOARD_PORT) : 3000,
});

console.log(
  "Dashboard running on http://localhost:" +
    (process.env.DASHBOARD_PORT || 3000)
);
