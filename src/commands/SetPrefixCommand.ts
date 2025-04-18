import { CommandInterface } from "../core/CommandInterface.js";
import { getMongoClient } from "../core/mongo.js";
import { GroupSettingService } from "../services/GroupSettingService.js";
import { getUserRoles } from "../core/config.js";
import { WebSocketInfo } from "../core/types.js";
import { SessionService } from "../services/SessionService.js";
import { proto } from "baileys";

export class SetPrefixCommand implements CommandInterface {
  static commandInfo = {
    name: "setprefix",
    description: "Set custom command prefix for this group (admin only)",
    helpText: `*Usage:*\n!setprefix <prefix>\n*Example:*\n!setprefix $`,
    category: "admin",
    commandClass: SetPrefixCommand,
    requiredRoles: ["admin"],
  };

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo
  ): Promise<void> {
    if (!jid.endsWith("@g.us")) {
      await sock.sendMessage(jid, {
        text: "This command can only be used in groups.",
      });
      return;
    }
    if (!getUserRoles(user).includes("admin")) {
      await sock.sendMessage(jid, {
        text: "Only group admins can change the prefix.",
      });
      return;
    }
    const prefix = args[0];
    if (!prefix) {
      await sock.sendMessage(jid, {
        text: "Please specify a prefix. Example: !setprefix $",
      });
      return;
    }
    const client = await getMongoClient();
    const groupService = new GroupSettingService(client);
    await groupService.set(jid, { prefix });
    await sock.sendMessage(jid, { text: `Group prefix set to *${prefix}*.` });
  }
}
