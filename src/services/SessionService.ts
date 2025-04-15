import { BotConfig } from "../core/config.js";
import { Session } from "../core/types.js";

export class SessionService {
  private sessions: Map<string, Map<string, Session>> = new Map();

  getSession<T>(jid: string, user: string): Session<T> | null {
    try {
      const userSessions = this.sessions.get(jid);
      if (!userSessions) return null;

      const session = userSessions.get(user);
      if (!session) return null;

      // timeout 1 jam
      if (Date.now() - session.timestamp > 3600000) {
        return null;
      }

      return session;
    } catch (error) {
      console.error("Error getting session:", error);
      return null;
    }
  }

  getAllSessionsInChat<T>(jid: string): Session<T>[] {
    try {
      const userSessions = this.sessions.get(jid);
      if (!userSessions) return [];

      const result: Session<T>[] = [];
      const now = Date.now();

      userSessions.forEach((session) => {
        if (now - session.timestamp <= 3600000) {
          result.push(session as Session<T>);
        }
      });

      return result;
    } catch (error) {
      console.error("Error getting all sessions in chat:", error);
      return [];
    }
  }

  private checkSessionLimit(jid: string, user: string): boolean {
    const userSessions = this.sessions.get(jid);
    if (userSessions && userSessions.size >= BotConfig.maxSessions) {
      return false;
    }
    return true;
  }

  setSession<T>(jid: string, user: string, game: string, data: T): boolean {
    if (!this.checkSessionLimit(jid, user)) {
      return false;
    }

    try {
      let userSessions = this.sessions.get(jid);
      if (!userSessions) {
        userSessions = new Map();
        this.sessions.set(jid, userSessions);
      }

      userSessions.set(user, {
        game,
        data,
        timestamp: Date.now(),
      });
      return true;
    } catch (error) {
      console.error("Error setting session:", error);
      return false;
    }
  }

  clearSession(jid: string, user: string): void {
    try {
      const userSessions = this.sessions.get(jid);
      if (userSessions) {
        userSessions.delete(user);

        if (userSessions.size === 0) {
          this.sessions.delete(jid);
        }
      }
    } catch (error) {
      console.error("Error clearing session:", error);
    }
  }

  cleanupExpiredSessions(): void {
    const now = Date.now();
    this.sessions.forEach((userSessions, jid) => {
      userSessions.forEach((session, user) => {
        if (now - session.timestamp > 3600000) {
          userSessions.delete(user);
        }
      });
      if (userSessions.size === 0) {
        this.sessions.delete(jid);
      }
    });
  }
}
