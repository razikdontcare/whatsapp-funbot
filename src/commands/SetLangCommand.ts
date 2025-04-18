import { CommandInterface } from "../core/CommandInterface.js";
import { getMongoClient } from "../core/mongo.js";
import { UserPreferenceService } from "../services/UserPreferenceService.js";
import { BotConfig } from "../core/config.js";
import { WebSocketInfo } from "../core/types.js";
import { SessionService } from "../services/SessionService.js";
import { proto } from "baileys";

export class SetLangCommand implements CommandInterface {
  static commandInfo = {
    name: "setlang",
    description: "Set your preferred language (e.g., id, en)",
    helpText: `*Usage:*\n!setlang <lang>\n*Example:*\n!setlang id`,
    category: "general",
    commandClass: SetLangCommand,
  };

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo
  ): Promise<void> {
    const lang = args[0]?.toLowerCase();
    if (!lang) {
      await sock.sendMessage(jid, {
        text: "Please specify a language code. Example: !setlang id",
      });
      return;
    }
    const client = await getMongoClient();
    const prefService = new UserPreferenceService(client);
    await prefService.set(user, { language: lang });
    await sock.sendMessage(jid, {
      text: `Language preference set to *${lang}*.`,
    });
  }
}
