import { makeWASocket } from "baileys";

export interface Session<T = any> {
  game: string;
  data: T;
  timestamp: number;
}

export type WebSocketInfo = ReturnType<typeof makeWASocket>;

export interface KBBIResponse {
  lemma: string;
  definition: string;
}
