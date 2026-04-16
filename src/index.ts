import { getDb } from "./db";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { sql } from "drizzle-orm";
import { backfillFts } from "./db/fts";
import { createApp, handleWsMessage, handleWsClose, type AppContext } from "./server";
import { ProjectManager } from "./runtime/project-manager";
import { Scheduler } from "./runtime/scheduler";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getPackageRoot } from "./utils/package-root";
import { isAuthEnabled, getJwtSecret } from "./lib/auth-config";
import { jwtVerify } from "jose";
import homepage from "./frontend/index.html";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_PORT = 8080;

export interface StartOptions {
  port?: number;
}

export async function startServer(opts: StartOptions = {}) {
  const port = opts.port ?? parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const DEV = process.env.NODE_ENV !== "production";
  const root = getPackageRoot(__dirname);
  const migrationsDir = join(root, "drizzle");

  // 1. Init database + run migrations
  // Disable foreign keys before migrating — SQLite ignores PRAGMA foreign_keys=OFF
  // inside transactions, and Drizzle wraps migrations in a transaction. Without this,
  // any migration that recreates a table (DROP TABLE) will cascade-delete related data.
  const db = getDb();
  try {
    db.run(sql`PRAGMA foreign_keys = OFF`);
    migrate(db, { migrationsFolder: migrationsDir });
    console.log("Database migrations applied");
  } catch (err) {
    console.error("Migration error:", err);
    process.exit(1);
  } finally {
    db.run(sql`PRAGMA foreign_keys = ON`);
  }

  // 1b. Backfill FTS index (non-blocking)
  Promise.resolve().then(() => backfillFts());

  // 1c. Init auth + cleanup expired refresh tokens
  if (isAuthEnabled()) {
    getJwtSecret();
    db.run(sql`DELETE FROM refresh_tokens WHERE expires_at < datetime('now')`);
    console.log("Auth: enabled");
  } else {
    console.log("Auth: disabled (set SHIRE_USERNAME to enable)");
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

  // 5. Start server — Bun's HTML import handles both dev (HMR) and prod (pre-built manifest)
  type WsData = Record<string, unknown>;

  const server = Bun.serve<WsData>({
    port,
    development: DEV,
    routes: {
      "/api/*": {
        GET: (req: Request) => app.fetch(req),
        POST: (req: Request) => app.fetch(req),
        PUT: (req: Request) => app.fetch(req),
        PATCH: (req: Request) => app.fetch(req),
        DELETE: (req: Request) => app.fetch(req),
        OPTIONS: (req: Request) => app.fetch(req),
        HEAD: (req: Request) => app.fetch(req),
      },
      "/": homepage,
      "/*": homepage,
    },
    async fetch(req, server) {
      if (req.headers.get("upgrade") === "websocket") {
        if (isAuthEnabled()) {
          const url = new URL(req.url);
          const token = url.searchParams.get("token");
          if (!token) return new Response("Unauthorized", { status: 401 });
          try {
            const secret = new TextEncoder().encode(getJwtSecret());
            await jwtVerify(token, secret, { algorithms: ["HS256"] });
          } catch {
            return new Response("Unauthorized", { status: 401 });
          }
        }
        const upgraded = server.upgrade(req, { data: {} });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      return new Response("Not Found", { status: 404 });
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

  console.log(`Shire running at http://localhost:${server.port}${DEV ? " (dev)" : ""}`);
  return server;
}
