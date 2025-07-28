import { config } from "dotenv";
config();

import { BotClient } from "./core/BotClient.js";

const bot = new BotClient();

// Store bot client globally before importing API
(globalThis as any).__botClient = bot;

// Import API after bot client is available
import "./api.js";

bot.start().catch(console.error);
