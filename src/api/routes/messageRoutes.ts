import { Hono } from "hono";
import { MessageController } from "../controllers/messageController.js";

const messageRoutes = new Hono();

// Message routes
messageRoutes.post("/send-message", MessageController.sendMessage);

export { messageRoutes };