import { Context } from "hono";
import { BotClient } from "../../core/BotClient.js";

const JID_SUFFIX = "@s.whatsapp.net";

function getBotClient(): BotClient | null {
  // @ts-ignore
  return typeof globalThis.__botClient === "object"
    ? // @ts-ignore
      globalThis.__botClient
    : null;
}

export class MessageController {
  // Send a WhatsApp message
  static async sendMessage(c: Context) {
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
}