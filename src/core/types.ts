import { makeWASocket } from "baileys";

/**
 * Represents a user or group session (e.g. for a game or AI chat).
 */
export interface Session<T = any> {
  /** The name of the game or session type */
  game: string;
  /** Arbitrary session data */
  data: T;
  /** Last activity timestamp (ms since epoch) */
  timestamp: number;
}

/**
 * Type alias for the WhatsApp socket instance.
 */
export type WebSocketInfo = ReturnType<typeof makeWASocket>;
