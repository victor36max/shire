import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { readdir, stat, readFile, mkdir, unlink, rm, writeFile, access, rename } from "fs/promises";
import { join, resolve, basename, dirname } from "path";
import * as workspace from "../services/workspace";
import * as projectsService from "../services/projects";
import type { AppEnv } from "../types";
import { mimeFromPath } from "../utils/mime";

function resolveProjectId(nameOrId: string): string | null {
  const byId = projectsService.getProject(nameOrId);
  if (byId) return byId.id;
  const byName = projectsService.getProjectByName(nameOrId);
  return byName?.id ?? null;
}

export function safePath(sharedRoot: string, userPath: string): string | null {
  // Normalize: treat "/" or empty as the shared root itself
  const normalized = userPath === "/" || userPath === "" ? "." : userPath.replace(/^\/+/, "");
  const resolved = resolve(sharedRoot, normalized);
  // Guard against prefix collisions (e.g. /shared vs /shared-evil)
  if (resolved !== sharedRoot && !resolved.startsWith(sharedRoot + "/")) return null;
  return resolved;
}

const pathQuery = z.object({ path: z.string().optional() });
const requiredPathQuery = z.object({ path: z.string() });

export const sharedDriveRoutes = new Hono<AppEnv>()
  .get("/projects/:id/shared-drive", zValidator("query", pathQuery), async (c) => {
    const projectId = resolveProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Project not found" }, 404);

    const sharedRoot = workspace.sharedDir(projectId);
    const path = c.req.valid("query").path ?? "/";
    const fullPath = safePath(sharedRoot, path);
    if (!fullPath) return c.json({ error: "Invalid path" }, 400);

    try {
      await mkdir(sharedRoot, { recursive: true });
      const entries = await readdir(fullPath, { withFileTypes: true });
      const files = await Promise.all(
        entries.map(async (entry) => {
          const entryPath = join(fullPath, entry.name);
          const s = await stat(entryPath);
          return {
            name: entry.name,
            path: (path === "/" ? "/" : path + "/") + entry.name,
            type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
            size: s.size,
          };
        }),
      );
      return c.json({ files, currentPath: path });
    } catch {
      return c.json({
        files: [] as Array<{
          name: string;
          path: string;
          type: "file" | "directory";
          size: number;
        }>,
        currentPath: path,
      });
    }
  })
  .get(
    "/projects/:id/shared-drive/search",
    zValidator("query", z.object({ q: z.string() })),
    async (c) => {
      const projectId = resolveProjectId(c.req.param("id"));
      if (!projectId) return c.json({ error: "Project not found" }, 404);

      const sharedRoot = workspace.sharedDir(projectId);
      const { q } = c.req.valid("query");
      const query = q.toLowerCase();

      await mkdir(sharedRoot, { recursive: true });

      const results: Array<{
        name: string;
        path: string;
        type: "file" | "directory";
        size: number;
      }> = [];

      const MAX_RESULTS = 50;

      async function walk(dir: string, rel: string) {
        if (results.length >= MAX_RESULTS) return;
        try {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (results.length >= MAX_RESULTS) return;
            const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
            const entryFull = join(dir, entry.name);
            if (entry.name.toLowerCase().includes(query)) {
              const s = await stat(entryFull);
              results.push({
                name: entry.name,
                path: "/" + entryRel,
                type: entry.isDirectory() ? "directory" : "file",
                size: s.size,
              });
            }
            if (entry.isDirectory()) {
              await walk(entryFull, entryRel);
            }
          }
        } catch {
          // skip unreadable directories
        }
      }

      await walk(sharedRoot, "");
      return c.json({ files: results });
    },
  )
  .get("/projects/:id/shared-drive/preview", zValidator("query", requiredPathQuery), async (c) => {
    const projectId = resolveProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Project not found" }, 404);

    const sharedRoot = workspace.sharedDir(projectId);
    const { path } = c.req.valid("query");

    const fullPath = safePath(sharedRoot, path);
    if (!fullPath) return c.json({ error: "Invalid path" }, 400);

    try {
      const s = await stat(fullPath);
      if (s.size > 1024 * 1024) {
        return c.json({ error: "File too large for preview" }, 413);
      }
      const content = await readFile(fullPath, "utf-8");
      return c.json({ content, filename: basename(fullPath), size: s.size });
    } catch {
      return c.json({ error: "File not found" }, 404);
    }
  })
  .get("/projects/:id/shared-drive/download", zValidator("query", requiredPathQuery), async (c) => {
    const projectId = resolveProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Project not found" }, 404);

    const sharedRoot = workspace.sharedDir(projectId);
    const { path } = c.req.valid("query");

    const fullPath = safePath(sharedRoot, path);
    if (!fullPath) return c.json({ error: "Invalid path" }, 400);

    try {
      const data = await readFile(fullPath);
      const filename = basename(fullPath);
      const contentType = mimeFromPath(filename);
      const isSafeImage = contentType.startsWith("image/") && contentType !== "image/svg+xml";
      return new Response(data, {
        headers: {
          "Content-Disposition": `${isSafeImage ? "inline" : "attachment"}; filename="${filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
          "Content-Type": contentType,
        },
      });
    } catch {
      return c.json({ error: "File not found" }, 404);
    }
  })
  .post(
    "/projects/:id/shared-drive/directory",
    zValidator("json", z.object({ name: z.string(), path: z.string().optional() })),
    async (c) => {
      const projectId = resolveProjectId(c.req.param("id"));
      if (!projectId) return c.json({ error: "Project not found" }, 404);

      const sharedRoot = workspace.sharedDir(projectId);
      const { name, path: parentPath } = c.req.valid("json");
      const fullPath = safePath(sharedRoot, join(parentPath ?? "/", name));
      if (!fullPath) return c.json({ error: "Invalid path" }, 400);

      await mkdir(fullPath, { recursive: true });
      return c.json({ ok: true }, 201);
    },
  )
  .post(
    "/projects/:id/shared-drive/file",
    zValidator(
      "json",
      z.object({
        name: z
          .string()
          .min(1)
          .regex(/^[^/\\]+$/, "Name must not contain path separators"),
        path: z.string().optional(),
      }),
    ),
    async (c) => {
      const projectId = resolveProjectId(c.req.param("id"));
      if (!projectId) return c.json({ error: "Project not found" }, 404);

      const sharedRoot = workspace.sharedDir(projectId);
      const { name, path: parentPath } = c.req.valid("json");
      const filename = name.endsWith(".md") ? name : `${name}.md`;
      const relPath = join(parentPath ?? "/", filename);
      const fullPath = safePath(sharedRoot, relPath);
      if (!fullPath) return c.json({ error: "Invalid path" }, 400);

      const exists = await access(fullPath)
        .then(() => true)
        .catch(() => false);
      if (exists) return c.json({ error: "File already exists" }, 409);

      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, "", "utf-8");
      return c.json({ ok: true, path: relPath }, 201);
    },
  )
  .post("/projects/:id/shared-drive/upload", async (c) => {
    const projectId = resolveProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Project not found" }, 404);

    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      return c.json({ error: "Missing file field" }, 400);
    }

    const MAX_FILE_SIZE = 128 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      return c.json({ error: "File exceeds 128 MB limit" }, 413);
    }

    const safeName = basename(file.name);
    if (!safeName || safeName !== file.name || file.name.includes("..")) {
      return c.json({ error: "Invalid filename" }, 400);
    }

    const parentPath = typeof body.path === "string" ? body.path : "/";
    const sharedRoot = workspace.sharedDir(projectId);
    const fullPath = safePath(sharedRoot, join(parentPath, safeName));
    if (!fullPath) return c.json({ error: "Invalid path" }, 400);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(fullPath, buffer);
    return c.json({ ok: true }, 201);
  })
  .put(
    "/projects/:id/shared-drive/content",
    zValidator("json", z.object({ path: z.string(), content: z.string() })),
    async (c) => {
      const projectId = resolveProjectId(c.req.param("id"));
      if (!projectId) return c.json({ error: "Project not found" }, 404);

      const sharedRoot = workspace.sharedDir(projectId);
      const { path, content } = c.req.valid("json");

      const fullPath = safePath(sharedRoot, path);
      if (!fullPath) return c.json({ error: "Invalid path" }, 400);

      const MAX_CONTENT_SIZE = 1024 * 1024;
      if (Buffer.byteLength(content, "utf-8") > MAX_CONTENT_SIZE) {
        return c.json({ error: "Content exceeds 1 MB limit" }, 413);
      }

      try {
        const s = await stat(fullPath).catch(() => null);
        if (!s || s.isDirectory()) return c.json({ error: "File not found" }, 404);
        await writeFile(fullPath, content, "utf-8");
        return c.json({ ok: true });
      } catch {
        return c.json({ error: "Failed to write file" }, 500);
      }
    },
  )
  .patch(
    "/projects/:id/shared-drive/rename",
    zValidator(
      "json",
      z.object({
        path: z.string(),
        newName: z
          .string()
          .min(1)
          .regex(/^[^/\\]+$/, "Name must not contain path separators"),
      }),
    ),
    async (c) => {
      const projectId = resolveProjectId(c.req.param("id"));
      if (!projectId) return c.json({ error: "Project not found" }, 404);

      const sharedRoot = workspace.sharedDir(projectId);
      const { path, newName } = c.req.valid("json");

      const fullPath = safePath(sharedRoot, path);
      if (!fullPath) return c.json({ error: "Invalid path" }, 400);

      const parentDir = dirname(fullPath);
      const newFullPath = join(parentDir, newName);
      const newSafe = safePath(sharedRoot, join(dirname(path), newName));
      if (!newSafe) return c.json({ error: "Invalid new name" }, 400);

      try {
        await stat(fullPath);
      } catch {
        return c.json({ error: "Not found" }, 404);
      }

      const exists = await access(newFullPath)
        .then(() => true)
        .catch(() => false);
      if (exists) return c.json({ error: "A file with that name already exists" }, 409);

      await rename(fullPath, newFullPath);
      return c.json({ ok: true, newPath: join(dirname(path), newName) });
    },
  )
  .delete("/projects/:id/shared-drive", zValidator("query", requiredPathQuery), async (c) => {
    const projectId = resolveProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Project not found" }, 404);

    const sharedRoot = workspace.sharedDir(projectId);
    const { path } = c.req.valid("query");

    const fullPath = safePath(sharedRoot, path);
    if (!fullPath) return c.json({ error: "Invalid path" }, 400);

    try {
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        await rm(fullPath, { recursive: true, force: true });
      } else {
        await unlink(fullPath);
      }
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "Not found" }, 404);
    }
  });
