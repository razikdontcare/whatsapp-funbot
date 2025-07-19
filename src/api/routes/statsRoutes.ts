import { Hono } from "hono";
import { StatsController } from "../controllers/statsController.js";

const statsRoutes = new Hono();

// Stats routes
statsRoutes.get("/command-usage", StatsController.getCommandUsage);
statsRoutes.get("/leaderboard", StatsController.getLeaderboard);

export { statsRoutes };