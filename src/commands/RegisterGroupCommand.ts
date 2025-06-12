import { CommandInterface } from "../core/CommandInterface.js";
import { getMongoClient } from "../core/mongo.js";
import { Collection, MongoClient } from "mongodb";
import { getUserRoles } from "../core/config.js";
import { WebSocketInfo } from "../core/types.js";
import { SessionService } from "../services/SessionService.js";
import { proto } from "baileys";

// Collection name for group registry
const GROUP_REGISTRY_COLLECTION = "group_registry";

export class RegisterGroupCommand extends CommandInterface {
  static commandInfo = {
    name: "registergroup",
    description: "Register this group for scheduled tasks (admin only)",
    helpText: `*Usage:*\n!registergroup\nRegister this group so it receives scheduled messages (admin only).`,
    category: "admin",
    commandClass: RegisterGroupCommand,
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
    if (!(await getUserRoles(user)).includes("admin")) {
      await sock.sendMessage(jid, {
        text: "Only group admins can register the group.",
      });
      return;
    }
    const client = await getMongoClient();
    const collection: Collection = client
      .db()
      .collection(GROUP_REGISTRY_COLLECTION);
    await collection.updateOne(
      { group: jid },
      { $set: { group: jid, registeredAt: new Date() } },
      { upsert: true }
    );
    await sock.sendMessage(jid, {
      text: "Group registered for scheduled tasks!",
    });
  }
}

// Helper to fetch all registered group JIDs
export async function getAllRegisteredGroupJids(
  mongoClient?: MongoClient
): Promise<string[]> {
  const client = mongoClient || (await getMongoClient());
  const collection: Collection = client
    .db()
    .collection(GROUP_REGISTRY_COLLECTION);
  const docs = await collection.find({}).toArray();
  return docs.map((doc) => doc.group);
}
