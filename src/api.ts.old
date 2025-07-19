import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { getMongoClient } from "./core/mongo.js";
import { CommandUsageService } from "./services/CommandUsageService.js";
import { GameLeaderboardService } from "./services/GameLeaderboardService.js";
import { BotClient } from "./core/BotClient.js";
import { getBotConfigService } from "./core/config.js";

const app = new Hono();
const JID_SUFFIX = "@s.whatsapp.net";

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
  const { text, jid } = await c.req.json();
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
    let targetJid = jid.endsWith(JID_SUFFIX) ? jid : jid + JID_SUFFIX;
    await sock.sendMessage(targetJid, { text });
    return c.json({ success: true });
  } catch (err) {
    return c.json(
      { error: "Failed to send message", details: String(err) },
      500
    );
  }
});

// REST API: Get bot configuration
app.get("/api/config", async (c) => {
  try {
    const configService = await getBotConfigService();
    const config = await configService.getMergedConfig();

    // Remove sensitive data from response
    const safeConfig = {
      ...config,
      groqApiKey: config.groqApiKey ? "***" : undefined,
    };

    return c.json(safeConfig);
  } catch (err) {
    return c.json({ error: "Failed to fetch bot configuration" }, 500);
  }
});

// REST API: Update bot configuration
app.post("/api/config", async (c) => {
  try {
    const updates = await c.req.json();
    const configService = await getBotConfigService();

    // Remove sensitive fields that shouldn't be updated via API
    delete updates.groqApiKey;
    delete updates.sessionName;

    const success = await configService.updateConfig(updates, "api");

    if (success) {
      return c.json({ message: "Configuration updated successfully" });
    } else {
      return c.json({ error: "Failed to update configuration" }, 500);
    }
  } catch (err) {
    return c.json({ error: "Failed to update bot configuration" }, 500);
  }
});

// REST API: Reset bot configuration
app.post("/api/config/reset", async (c) => {
  try {
    const configService = await getBotConfigService();
    const success = await configService.resetToDefaults("api");

    if (success) {
      return c.json({
        message: "Configuration reset to defaults successfully",
      });
    } else {
      return c.json({ error: "Failed to reset configuration" }, 500);
    }
  } catch (err) {
    return c.json({ error: "Failed to reset bot configuration" }, 500);
  }
});

// REST API: Manage user roles
app.post("/api/config/roles/:action", async (c) => {
  try {
    const action = c.req.param("action"); // add or remove
    const { userJid, role } = await c.req.json();

    if (!userJid || !role) {
      return c.json({ error: "Missing userJid or role in request body" }, 400);
    }

    if (!["admin", "moderator", "vip"].includes(role)) {
      return c.json(
        { error: "Invalid role. Must be admin, moderator, or vip" },
        400
      );
    }

    const configService = await getBotConfigService();
    let success = false;

    if (action === "add") {
      success = await configService.addUserToRole(userJid, role as any, "api");
    } else if (action === "remove") {
      success = await configService.removeUserFromRole(
        userJid,
        role as any,
        "api"
      );
    } else {
      return c.json(
        { error: "Invalid action. Must be 'add' or 'remove'" },
        400
      );
    }

    if (success) {
      return c.json({
        message: `User ${
          action === "add" ? "added to" : "removed from"
        } ${role} role successfully`,
      });
    } else {
      return c.json(
        {
          error: `Failed to ${action} user ${
            action === "add" ? "to" : "from"
          } ${role} role`,
        },
        500
      );
    }
  } catch (err) {
    return c.json({ error: "Failed to manage user role" }, 500);
  }
});

serve({
  fetch: app.fetch,
  port: process.env.DASHBOARD_PORT
    ? parseInt(process.env.DASHBOARD_PORT, 10)
    : 5000,
});

console.log("API running on port " + (process.env.DASHBOARD_PORT || 5000));
