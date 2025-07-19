import { Hono } from "hono";
import { ConfigController } from "../controllers/configController.js";

const configRoutes = new Hono();

// Configuration routes
configRoutes.get("/", ConfigController.getConfig);
configRoutes.post("/", ConfigController.updateConfig);
configRoutes.post("/reset", ConfigController.resetConfig);
configRoutes.post("/roles/:action", ConfigController.manageUserRoles);

export { configRoutes };