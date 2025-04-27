import "dotenv/config";

import { BotClient } from "./core/BotClient.js";
import "./dashboard.js";

const bot = new BotClient();

// @ts-ignore
(globalThis as any).__botClient = bot;

bot.start().catch(console.error);
