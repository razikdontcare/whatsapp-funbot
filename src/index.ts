import "dotenv/config";

import { BotClient } from "./core/BotClient.js";

const bot = new BotClient();

bot.start().catch(console.error);
