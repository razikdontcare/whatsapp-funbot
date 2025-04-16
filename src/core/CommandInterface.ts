import { proto } from "baileys";
import { SessionService } from "../services/SessionService.js";
import { WebSocketInfo } from "./types.js";

export interface CommandInterface {
  handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo
  ): Promise<void>;
}
