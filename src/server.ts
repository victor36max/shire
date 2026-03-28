import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./types";
import { ProjectManager } from "./runtime/project-manager";
import { Scheduler } from "./runtime/scheduler";
import { bus, type BusEvent } from "./events";
import { projectRoutes } from "./routes/projects";
import { agentRoutes } from "./routes/agents";
import { messageRoutes } from "./routes/messages";
import { scheduleRoutes } from "./routes/schedules";
import { sharedDriveRoutes } from "./routes/shared-drive";
import { settingsRoutes } from "./routes/settings";
import { catalogRoutes } from "./routes/catalog";
import { attachmentRoutes } from "./routes/attachments";

export interface AppContext {
  projectManager: ProjectManager;
  scheduler: Scheduler;
}

export function createApp(ctx: AppContext) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:5173", "http://localhost:3000"];

  const app = new Hono<AppEnv>()
    .use("*", cors({ origin: allowedOrigins }))
    .use("*", async (c, next) => {
      await next();
      c.header("X-Content-Type-Options", "nosniff");
      c.header("X-Frame-Options", "DENY");
    })
    .use("*", async (c, next) => {
      c.set("projectManager", ctx.projectManager);
      c.set("scheduler", ctx.scheduler);
      await next();
    })
    .route("/api", projectRoutes)
    .route("/api", agentRoutes)
    .route("/api", messageRoutes)
    .route("/api", scheduleRoutes)
    .route("/api", sharedDriveRoutes)
    .route("/api", settingsRoutes)
    .route("/api", catalogRoutes)
    .route("/api", attachmentRoutes)
    .get("/api/health", (c) => c.json({ status: "ok" }));

  return app;
}

// Export the app type for Hono RPC client
export type AppType = ReturnType<typeof createApp>;

// WebSocket connection management
const wsSubscriptions = new Map<WebSocket, Map<string, () => void>>();

export function handleWsMessage(ws: WebSocket, data: string): void {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(data);
  } catch {
    return;
  }

  const subs = wsSubscriptions.get(ws) ?? new Map();
  wsSubscriptions.set(ws, subs);

  switch (msg.type) {
    case "subscribe": {
      const topic = msg.topic as string;
      if (!topic || subs.has(topic)) return;

      const unsub = bus.on(topic, (event: BusEvent) => {
        try {
          ws.send(JSON.stringify({ topic, ...event }));
        } catch {
          // ws closed
        }
      });
      subs.set(topic, unsub);
      break;
    }
    case "unsubscribe": {
      const topic = msg.topic as string;
      const unsub = subs.get(topic);
      if (unsub) {
        unsub();
        subs.delete(topic);
      }
      break;
    }
  }
}

export function handleWsClose(ws: WebSocket): void {
  const subs = wsSubscriptions.get(ws);
  if (subs) {
    for (const unsub of subs.values()) unsub();
    wsSubscriptions.delete(ws);
  }
}
