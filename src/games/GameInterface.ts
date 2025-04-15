import { SessionService } from "../services/SessionService.js";
import { WebSocketInfo } from "../core/types.js";

export interface GameInterface {
  handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService
  ): Promise<void>;
}
