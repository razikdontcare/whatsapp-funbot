export interface Session<T = any> {
  game: string;
  data: T;
  timestamp: number;
}

export type WebSocketInfo = import("baileys").WASocket;
