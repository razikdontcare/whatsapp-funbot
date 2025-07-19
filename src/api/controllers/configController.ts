import { Context } from "hono";
import { getBotConfigService } from "../../core/config.js";

export class ConfigController {
  // Get bot configuration
  static async getConfig(c: Context) {
    try {
      const configService = await getBotConfigService();
      const config = await configService.getMergedConfig();

      // Remove sensitive data from response
      const safeConfig = {
        ...config,
        groqApiKey: config.groqApiKey ? "***" : undefined,
      };

      return c.json(safeConfig);
    } catch (err) {
      return c.json({ error: "Failed to fetch bot configuration" }, 500);
    }
  }

  // Update bot configuration
  static async updateConfig(c: Context) {
    try {
      const updates = await c.req.json();
      const configService = await getBotConfigService();

      // Remove sensitive fields that shouldn't be updated via API
      delete updates.groqApiKey;
      delete updates.sessionName;

      const success = await configService.updateConfig(updates, "api");

      if (success) {
        return c.json({ message: "Configuration updated successfully" });
      } else {
        return c.json({ error: "Failed to update configuration" }, 500);
      }
    } catch (err) {
      return c.json({ error: "Failed to update bot configuration" }, 500);
    }
  }

  // Reset bot configuration
  static async resetConfig(c: Context) {
    try {
      const configService = await getBotConfigService();
      const success = await configService.resetToDefaults("api");

      if (success) {
        return c.json({
          message: "Configuration reset to defaults successfully",
        });
      } else {
        return c.json({ error: "Failed to reset configuration" }, 500);
      }
    } catch (err) {
      return c.json({ error: "Failed to reset bot configuration" }, 500);
    }
  }

  // Manage user roles
  static async manageUserRoles(c: Context) {
    try {
      const action = c.req.param("action"); // add or remove
      const { userJid, role } = await c.req.json();

      if (!userJid || !role) {
        return c.json({ error: "Missing userJid or role in request body" }, 400);
      }

      if (!["admin", "moderator", "vip"].includes(role)) {
        return c.json(
          { error: "Invalid role. Must be admin, moderator, or vip" },
          400
        );
      }

      const configService = await getBotConfigService();
      let success = false;

      if (action === "add") {
        success = await configService.addUserToRole(userJid, role as any, "api");
      } else if (action === "remove") {
        success = await configService.removeUserFromRole(
          userJid,
          role as any,
          "api"
        );
      } else {
        return c.json(
          { error: "Invalid action. Must be 'add' or 'remove'" },
          400
        );
      }

      if (success) {
        return c.json({
          message: `User ${
            action === "add" ? "added to" : "removed from"
          } ${role} role successfully`,
        });
      } else {
        return c.json(
          {
            error: `Failed to ${action} user ${
              action === "add" ? "to" : "from"
            } ${role} role`,
          },
          500
        );
      }
    } catch (err) {
      return c.json({ error: "Failed to manage user role" }, 500);
    }
  }
}