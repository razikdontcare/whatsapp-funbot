import { config } from "dotenv";
config();

import { BotClient } from "./core/BotClient.js";
import "./api/server.js";

const bot = new BotClient();

// Global reference for API access
(globalThis as any).__botClient = bot;

bot.start().catch(console.error);
