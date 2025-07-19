import cron from "node-cron";
import { getMongoClient } from "../core/mongo.js";
import { GroupSettingService } from "../services/GroupSettingService.js";
import { BotConfig } from "../core/config.js";
import { WebSocketInfo } from "../core/types.js";
import { getAllRegisteredGroupJids } from "../commands/admin/RegisterGroupCommand.js";

// Example: Send a "Good morning!" message to all groups every day at 7am
export async function scheduleDailyMorningMessage(sock: WebSocketInfo) {
  cron.schedule("0 7 * * *", async () => {
    const client = await getMongoClient();
    const groupService = new GroupSettingService(client);
    // Fetch all registered group JIDs from the database
    const groupJids = await getAllRegisteredGroupJids(client);
    for (const jid of groupJids) {
      // Optionally, check if group has enabled daily messages
      const groupSetting = await groupService.get(jid);
      if (groupSetting?.welcomeMessage) {
        await sock.sendMessage(jid, { text: groupSetting.welcomeMessage });
      } else {
        await sock.sendMessage(jid, {
          text: `Good morning from ${BotConfig.name}!`,
        });
      }
    }
  });
}
