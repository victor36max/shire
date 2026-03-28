import { getDb } from "./db";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createApp, handleWsMessage, handleWsClose, type AppContext } from "./server";
import { ProjectManager } from "./runtime/project-manager";
import { Scheduler } from "./runtime/scheduler";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_PORT = 8080;

/**
 * Resolves the root directory for packaged assets (drizzle/).
 *
 * When running from source: __dirname is src/, root is one level up.
 * When running as a compiled binary: assets sit alongside the binary.
 */
function getPackageRoot(): string {
  // Bun compiled binaries: execPath equals argv[0] (the binary itself)
  const isBunCompiled = typeof Bun !== "undefined" && process.execPath === process.argv[0];
  if (isBunCompiled) {
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

  // 5. Start server — dev uses Bun's fullstack bundler, prod serves pre-built files
  type WsData = Record<string, unknown>;

  if (DEV) {
    // Dynamic import of HTML for Bun's fullstack dev bundler (HMR, CSS processing)
    // Variable path prevents bun build --compile from bundling this
    const htmlPath = "./frontend/index.html";
    const homepage = await import(htmlPath);

    const server = Bun.serve<WsData>({
      port,
      development: true,
      routes: {
        "/": homepage.default,
        "/*": homepage.default,
      },
      async fetch(req, server) {
        const url = new URL(req.url);

        if (req.headers.get("upgrade") === "websocket") {
          const upgraded = server.upgrade(req, { data: {} });
          if (upgraded) return undefined;
          return new Response("WebSocket upgrade failed", { status: 400 });
        }

        if (url.pathname.startsWith("/api")) {
          return app.fetch(req);
        }

        // Fallback
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

    console.log(`Shire running at http://localhost:${server.port} (dev)`);
    return server;
  }

  // Production: serve pre-built static files
  const FRONTEND_DIST = join(root, "frontend");
  const indexHtml = existsSync(join(FRONTEND_DIST, "index.html"))
    ? Bun.file(join(FRONTEND_DIST, "index.html"))
    : null;

  const server = Bun.serve<WsData>({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);

      if (req.headers.get("upgrade") === "websocket") {
        const upgraded = server.upgrade(req, { data: {} });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      if (url.pathname.startsWith("/api")) {
        return app.fetch(req);
      }

      return serveStatic(url, FRONTEND_DIST, indexHtml);
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
  return server;
}

// Production: serve pre-built frontend static files
async function serveStatic(
  url: URL,
  frontendDist: string,
  indexHtml: ReturnType<typeof Bun.file> | null,
): Promise<Response> {
  const filePath = resolve(join(frontendDist, url.pathname));

  // Prevent path traversal — resolved path must stay within frontendDist
  if (!filePath.startsWith(frontendDist + "/") && filePath !== frontendDist) {
    return new Response("Forbidden", { status: 403 });
  }

  // Serve static files (must have a file extension in the last segment)
  const lastSegment = filePath.substring(filePath.lastIndexOf("/") + 1);
  if (lastSegment.includes(".")) {
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }
  }

  // SPA fallback
  if (indexHtml) {
    return new Response(indexHtml);
  }

  return new Response("Not Found", { status: 404 });
}
