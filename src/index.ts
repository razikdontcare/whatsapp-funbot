import { config } from "dotenv";
config();

import { BotClient } from "./core/BotClient.js";
import "./api.js";

const bot = new BotClient();

// // @ts-ignore
(globalThis as any).__botClient = bot;

bot.start().catch(console.error);
