#!/usr/bin/env bun
import { getDb } from "./db";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createApp, handleWsMessage, handleWsClose, type AppContext } from "./server";
import { ProjectManager } from "./runtime/project-manager";
import { Scheduler } from "./runtime/scheduler";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const DEV = process.env.NODE_ENV !== "production";
const FRONTEND_DIST = join(__dirname, "frontend", "dist");
const VITE_DEV_URL = "http://localhost:5173";

async function main() {
  // 1. Init database + run migrations
  const db = getDb();
  const migrationsDir = join(__dirname, "..", "drizzle");
  try {
    migrate(db, { migrationsFolder: migrationsDir });
    console.log("Database migrations applied");
  } catch (err) {
    console.error("Migration error:", err);
    process.exit(1);
  }

  // 2. Boot project manager
  const projectManager = new ProjectManager();
  await projectManager.boot();

  // 3. Boot scheduler
  const scheduler = new Scheduler(projectManager);
  scheduler.boot();

  // 4. Create HTTP app
  const ctx: AppContext = { projectManager, scheduler };
  const app = createApp(ctx);

  // 5. Start server
  type WsData = Record<string, unknown>;

  const server = Bun.serve<WsData>({
    port: PORT,
    async fetch(req, server) {
      const url = new URL(req.url);

      // WebSocket upgrade
      if (req.headers.get("upgrade") === "websocket") {
        const upgraded = server.upgrade(req, { data: {} });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // API routes
      if (url.pathname.startsWith("/api")) {
        return app.fetch(req);
      }

      // Frontend: dev mode → proxy to Vite, prod → serve static files
      if (DEV) {
        return proxyToVite(req, url);
      }
      return await serveStatic(url);
    },
    websocket: {
      message(ws, message) {
        handleWsMessage(ws, String(message));
      },
      close(ws) {
        handleWsClose(ws);
      },
    },
  });

  console.log(`Shire running at http://localhost:${server.port}`);
  if (DEV) {
    console.log(`  Frontend: proxying to Vite at ${VITE_DEV_URL}`);
    console.log(`  Run "cd src/frontend && bun run dev" to start Vite`);
  }
}

// Dev: proxy non-API requests to Vite dev server
async function proxyToVite(req: Request, url: URL): Promise<Response> {
  const viteUrl = `${VITE_DEV_URL}${url.pathname}${url.search}`;
  try {
    return await fetch(viteUrl, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
  } catch {
    return new Response(
      "Vite dev server not running. Start it with: cd src/frontend && bun run dev",
      {
        status: 502,
      },
    );
  }
}

// Production: serve pre-built frontend static files
async function serveStatic(url: URL): Promise<Response> {
  let filePath = join(FRONTEND_DIST, url.pathname);

  // SPA fallback: serve index.html for non-file routes
  const file = Bun.file(filePath);
  if (!(await file.exists()) || !filePath.includes(".")) {
    filePath = join(FRONTEND_DIST, "index.html");
  }

  const indexFile = Bun.file(filePath);
  if (!(await indexFile.exists())) {
    return new Response("Not Found", { status: 404 });
  }

  const ext = filePath.split(".").pop() ?? "";
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  return new Response(indexFile, {
    headers: { "Content-Type": contentType },
  });
}

const MIME_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "application/javascript",
  css: "text/css",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
};

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
