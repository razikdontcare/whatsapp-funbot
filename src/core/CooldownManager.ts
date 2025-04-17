import { log } from "./config.js";

interface CooldownInfo {
  timestamp: number;
  count: number;
}

/**
 * Manages cooldowns for commands to prevent abuse
 */
export class CooldownManager {
  private cooldowns: Map<string, CooldownInfo> = new Map();
  private readonly cleanupInterval = 3600000; // 1 hour in milliseconds

  constructor() {
    // Periodically clean up expired cooldowns
    setInterval(() => this.cleanup(), this.cleanupInterval);
  }

  /**
   * Checks if a command is on cooldown for a user
   *
   * @param userId User ID
   * @param command Command name
   * @param cooldownMs Cooldown in milliseconds
   * @param maxUses Maximum uses before triggering cooldown (default: 1)
   * @returns Whether the command is on cooldown
   */
  isOnCooldown(
    userId: string,
    command: string,
    cooldownMs: number,
    maxUses: number = 1
  ): boolean {
    const key = `${userId}:${command}`;
    const now = Date.now();

    // Get current cooldown info
    const cooldownInfo = this.cooldowns.get(key);

    if (!cooldownInfo) {
      // No cooldown yet, register first use
      this.cooldowns.set(key, { timestamp: now, count: 1 });
      return false;
    }

    // Check if cooldown has expired
    if (now - cooldownInfo.timestamp > cooldownMs) {
      // Reset cooldown
      this.cooldowns.set(key, { timestamp: now, count: 1 });
      return false;
    }

    // Increment usage count
    cooldownInfo.count++;
    this.cooldowns.set(key, cooldownInfo);

    // On cooldown if usage count exceeds max uses
    return cooldownInfo.count > maxUses;
  }

  /**
   * Gets the remaining cooldown time in seconds
   */
  getRemainingCooldown(
    userId: string,
    command: string,
    cooldownMs: number
  ): number {
    const key = `${userId}:${command}`;
    const cooldownInfo = this.cooldowns.get(key);

    if (!cooldownInfo) {
      return 0;
    }

    const elapsed = Date.now() - cooldownInfo.timestamp;
    const remaining = cooldownMs - elapsed;

    return Math.max(0, Math.ceil(remaining / 1000));
  }

  /**
   * Resets the cooldown for a user and command
   */
  resetCooldown(userId: string, command: string): void {
    const key = `${userId}:${command}`;
    this.cooldowns.delete(key);
  }

  /**
   * Removes expired cooldowns to prevent memory leaks
   */
  private cleanup(): void {
    const now = Date.now();
    let count = 0;

    for (const [key, info] of this.cooldowns.entries()) {
      // Assume a max cooldown of 24 hours for cleanup
      if (now - info.timestamp > 86400000) {
        this.cooldowns.delete(key);
        count++;
      }
    }

    if (count > 0) {
      log.debug(`Cleaned up ${count} expired cooldowns`);
    }
  }
}
