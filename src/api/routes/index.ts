import { Hono } from "hono";
import { configRoutes } from "./configRoutes.js";
import { statsRoutes } from "./statsRoutes.js";
import { messageRoutes } from "./messageRoutes.js";

const apiRoutes = new Hono();

// Mount route groups
apiRoutes.route("/config", configRoutes);
apiRoutes.route("/stats", statsRoutes);
apiRoutes.route("/message", messageRoutes);

export { apiRoutes };