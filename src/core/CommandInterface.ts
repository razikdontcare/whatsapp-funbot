import { proto } from "baileys";
import { SessionService } from "../services/SessionService.js";
import { WebSocketInfo } from "./types.js";

export type CommandInfo = {
  name: string;
  aliases?: string[];
  description: string;
  helpText: string;
  category: string;
  commandClass: typeof CommandInterface;
  cooldown?: number;
  maxUses?: number;
  requiredRoles?: string[];
};

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
