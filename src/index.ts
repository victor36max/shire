import { getDb } from "./db";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createApp, handleWsMessage, handleWsClose, type AppContext } from "./server";
import { ProjectManager } from "./runtime/project-manager";
import { Scheduler } from "./runtime/scheduler";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import homepage from "./frontend/index.html";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_PORT = 8080;

/**
 * Resolves the root directory for packaged assets (drizzle/).
 *
 * When running from source: __dirname is src/, root is one level up.
 * When running as a compiled binary: assets sit alongside the binary.
 */
function getPackageRoot(): string {
  // In a compiled Bun binary, argv[1] starts with /$bunfs/root/
  if (process.argv[1]?.startsWith("/$bunfs/")) {
    return dirname(process.execPath);
  }
  return join(__dirname, "..");
}

export interface StartOptions {
  port?: number;
}

export async function startServer(opts: StartOptions = {}) {
  const port = opts.port ?? parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const DEV = process.env.NODE_ENV !== "production";
  const root = getPackageRoot();
  const migrationsDir = join(root, "drizzle");

  // 1. Init database + run migrations
  const db = getDb();
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
