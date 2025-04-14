import { makeWASocket } from "baileys";

export interface GameCommand {
  name: string;
  description: string;
  aliases?: string[];
  usage?: string;
}

export interface GameSession<T = any> {
  game: string;
  data: T;
  timestamp: number;
}

export type WebSocketInfo = ReturnType<typeof makeWASocket>;

export interface KBBIResponse {
  lemma: string;
  definition: string;
}
