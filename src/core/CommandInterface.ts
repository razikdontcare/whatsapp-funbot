import { proto } from "baileys";
import { SessionService } from "../services/SessionService.js";
import { WebSocketInfo } from "./types.js";
import { CommandCategory } from "../types/command-category.js";

/**
 * Metadata describing a command for registration and help.
 */

export interface CommandInfo {
  /** Command name (used for invocation) */
  name: string;
  /** Optional aliases for the command */
  aliases?: string[];
  /** Short description for help */
  description: string;
  /** Extended help text */
  helpText?: string;
  /** Command category (game, admin, etc) */
  category: CommandCategory;
  /** The class implementing the command */
  commandClass: new () => CommandInterface;
  /** Optional cooldown in ms */
  cooldown?: number;
  /** Optional max uses before cooldown */
  maxUses?: number;
  /** Required user roles */
  requiredRoles?: import("./config.js").UserRole[];
  /** If true, command is disabled */
  disabled?: boolean;
  /** Reason for disabling */
  disabledReason?: string;
}

/**
 * Base interface for all command classes.
 */
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

/**
 * Abstract base class for all commands. Extend this to implement a new command.
 */
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
