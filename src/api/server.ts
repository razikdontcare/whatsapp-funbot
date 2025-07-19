import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { apiRoutes } from "./routes/index.js";

const app = new Hono();

// Mount API routes
app.route("/api", apiRoutes);

// Legacy routes for backward compatibility
app.get("/api/command-usage", async (c) => {
  return app.fetch(new Request(`${c.req.url.replace('/api/command-usage', '/api/stats/command-usage')}`));
});

app.get("/api/leaderboard", async (c) => {
  return app.fetch(new Request(`${c.req.url.replace('/api/leaderboard', '/api/stats/leaderboard')}`));
});

app.post("/api/send-message", async (c) => {
  return app.fetch(new Request(`${c.req.url.replace('/api/send-message', '/api/message/send-message')}`, {
    method: 'POST',
    body: await c.req.raw.clone().text(),
    headers: c.req.header()
  }));
});

// Start the server
const port = process.env.DASHBOARD_PORT
  ? parseInt(process.env.DASHBOARD_PORT, 10)
  : 5000;

serve({
  fetch: app.fetch,
  port,
});

console.log(`API running on port ${port}`);