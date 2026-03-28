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
    : ["http://localhost:5173", "http://localhost:4000"];

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

/** Minimal WebSocket interface covering both DOM WebSocket and Bun ServerWebSocket. */
interface WsLike {
  send(data: string): void;
}

// WebSocket connection management
const wsSubscriptions = new Map<WsLike, Map<string, () => void>>();

type WsCommand = { type: "subscribe"; topic: string } | { type: "unsubscribe"; topic: string };

function parseWsCommand(data: string): WsCommand | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.topic !== "string") return null;
  if (obj.type === "subscribe" || obj.type === "unsubscribe") {
    return { type: obj.type, topic: obj.topic };
  }
  return null;
}

export function handleWsMessage(ws: WsLike, data: string): void {
  const cmd = parseWsCommand(data);
  if (!cmd) return;

  const subs = wsSubscriptions.get(ws) ?? new Map();
  wsSubscriptions.set(ws, subs);

  switch (cmd.type) {
    case "subscribe": {
      if (!cmd.topic || subs.has(cmd.topic)) return;
      const unsub = bus.on(cmd.topic, (event: BusEvent) => {
        try {
          ws.send(JSON.stringify({ topic: cmd.topic, ...event }));
        } catch {
          // ws closed
        }
      });
      subs.set(cmd.topic, unsub);
      break;
    }
    case "unsubscribe": {
      const unsub = subs.get(cmd.topic);
      if (unsub) {
        unsub();
        subs.delete(cmd.topic);
      }
      break;
    }
  }
}

export function handleWsClose(ws: WsLike): void {
  const subs = wsSubscriptions.get(ws);
  if (subs) {
    for (const unsub of subs.values()) unsub();
    wsSubscriptions.delete(ws);
  }
}
