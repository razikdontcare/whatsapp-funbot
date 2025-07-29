import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { getMongoClient } from "./core/mongo.js";
import { CommandUsageService } from "./services/CommandUsageService.js";
import { GameLeaderboardService } from "./services/GameLeaderboardService.js";
import { BotClient } from "./core/BotClient.js";
import { getBotConfigService } from "./core/config.js";
import QRCode from "qrcode";

const app = new Hono();

// --- Simple in-memory rate limiter ---
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 10; // max requests per window

function getClientIP(c: any): string {
  // Try to get IP from headers or connection
  return (
    c.req.header("x-forwarded-for") ||
    c.req.header("x-real-ip") ||
    c.req.raw?.socket?.remoteAddress ||
    "unknown"
  );
}

function rateLimitMiddleware(path: string) {
  return async (c: any, next: any) => {
    const ip = getClientIP(c);
    const key = `${path}:${ip}`;
    const now = Date.now();
    let entry = rateLimitStore.get(key);
    if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
      entry = { count: 1, start: now };
    } else {
      entry.count++;
    }
    rateLimitStore.set(key, entry);
    if (entry.count > RATE_LIMIT_MAX) {
      return c.json({ error: "Rate limit exceeded. Try again later." }, 429);
    }
    await next();
  };
}

// --- Simple token auth for QR endpoint ---
const QR_AUTH_TOKEN = process.env.QR_AUTH_TOKEN || "changeme";
function qrAuthMiddleware(c: any, next: any) {
  const auth = c.req.header("authorization") || c.req.query("token");
  if (!auth || auth.replace(/^Bearer /, "") !== QR_AUTH_TOKEN) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
}
const JID_SUFFIX = "@s.whatsapp.net";

// Store SSE connections for QR code updates
const qrConnections = new Set<any>();

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
app.post(
  "/api/send-message",
  rateLimitMiddleware("/api/send-message"),
  async (c) => {
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
  }
);

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

// REST API: Get current QR code as image for WhatsApp authentication
app.get(
  "/api/qr",
  rateLimitMiddleware("/api/qr"),
  qrAuthMiddleware,
  async (c) => {
    try {
      const botClient = getBotClient();
      if (!botClient) {
        return c.json({ error: "Bot client not available" }, 503);
      }

      const qr = (botClient as any).currentQR;
      if (!qr) {
        return c.json(
          {
            error: "No QR code available",
            message: "Bot may already be connected or QR code expired",
          },
          404
        );
      }

      // Generate QR code as PNG buffer
      const qrBuffer = await QRCode.toBuffer(qr, {
        type: "png",
        width: 300,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      });

      // Return image response
      c.header("Content-Type", "image/png");
      c.header("Cache-Control", "no-cache");
      return c.body(qrBuffer);
    } catch (err) {
      return c.json(
        { error: "Failed to generate QR code", details: String(err) },
        500
      );
    }
  }
);

// REST API: Get current QR code as JSON (alternative endpoint)
app.get("/api/qr/json", rateLimitMiddleware("/api/qr/json"), async (c) => {
  try {
    const botClient = getBotClient();
    if (!botClient) {
      return c.json({ error: "Bot client not available" }, 503);
    }

    const qr = (botClient as any).currentQR;
    if (!qr) {
      return c.json(
        {
          error: "No QR code available",
          message: "Bot may already be connected or QR code expired",
        },
        404
      );
    }

    return c.json({ qr, timestamp: Date.now() });
  } catch (err) {
    return c.json(
      { error: "Failed to get QR code", details: String(err) },
      500
    );
  }
});

// REST API: Server-Sent Events for QR code updates
app.get("/api/qr/stream", rateLimitMiddleware("/api/qr/stream"), async (c) => {
  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));

      // Store connection for QR updates
      const connection = {
        controller,
        encoder,
        send: (data: any) => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
            );
          } catch (err) {
            // Connection closed, remove from set
            qrConnections.delete(connection);
          }
        },
      };

      qrConnections.add(connection);

      // Send current QR status
      const botClient = getBotClient();
      if (botClient) {
        const qr = (botClient as any).currentQR;
        const sock = (botClient as any)["sock"];
        const connected = !!(sock && sock.user);

        connection.send({
          type: "status",
          connected,
          hasQR: !!qr,
          timestamp: Date.now(),
        });
      }
    },
    cancel() {
      // Remove connection when stream is cancelled
      qrConnections.forEach((conn) => {
        if (conn.controller === this) {
          qrConnections.delete(conn);
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    },
  });
});

// Function to broadcast QR updates to all SSE connections
export function broadcastQRUpdate(
  type: "new_qr" | "connected" | "disconnected",
  data?: any
) {
  const message = {
    type,
    timestamp: Date.now(),
    ...data,
  };

  qrConnections.forEach((connection) => {
    connection.send(message);
  });
}

// REST API: Get bot connection status
app.get("/api/status", async (c) => {
  try {
    const botClient = getBotClient();
    if (!botClient) {
      return c.json({ status: "unavailable", connected: false });
    }

    const sock = (botClient as any)["sock"];
    const hasQR = !!(botClient as any).currentQR;
    const connected = !!(sock && sock.user);

    return c.json({
      status: connected ? "connected" : hasQR ? "qr_ready" : "disconnected",
      connected,
      hasQR,
      user: connected ? sock.user : null,
    });
  } catch (err) {
    return c.json({ status: "error", connected: false }, 500);
  }
});

serve({
  fetch: app.fetch,
  port: process.env.DASHBOARD_PORT
    ? parseInt(process.env.DASHBOARD_PORT, 10)
    : 5000,
});

console.log("API running on port " + (process.env.DASHBOARD_PORT || 5000));
