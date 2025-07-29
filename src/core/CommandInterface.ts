import { proto } from "baileys";
import { SessionService } from "../services/SessionService.js";
import { WebSocketInfo } from "./types.js";
import { CommandCategory } from "../types/command-category.js";

export interface CommandInfo {
  name: string;
  aliases?: string[];
  description: string;
  helpText?: string; // Inline command documentation
  category: CommandCategory;
  commandClass: new () => CommandInterface;
  cooldown?: number;
  maxUses?: number;
  requiredRoles?: import("./config.js").UserRole[];
  disabled?: boolean;
  disabledReason?: string;
}

export interface BaseInterface {
  handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo
  ): Promise<void>;
}

export abstract class CommandInterface implements BaseInterface {
  static commandInfo: CommandInfo;

  abstract handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo
  ): Promise<void>;
}
