import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { readdir, stat, readFile, mkdir, unlink, rm, writeFile } from "fs/promises";
import { join, resolve, basename } from "path";
import * as workspace from "../services/workspace";
import * as projectsService from "../services/projects";
import type { AppEnv } from "../types";

function resolveProjectId(nameOrId: string): string | null {
  const byId = projectsService.getProject(nameOrId);
  if (byId) return byId.id;
  const byName = projectsService.getProjectByName(nameOrId);
  return byName?.id ?? null;
}

function safePath(sharedRoot: string, userPath: string): string | null {
  // Normalize: treat "/" or empty as the shared root itself
  const normalized = userPath === "/" || userPath === "" ? "." : userPath.replace(/^\//, "");
  const resolved = resolve(sharedRoot, normalized);
  if (!resolved.startsWith(sharedRoot)) return null;
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
            path: join(path, entry.name),
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
      return new Response(data, {
        headers: {
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Type": "application/octet-stream",
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
    "/projects/:id/shared-drive/upload",
    zValidator(
      "json",
      z.object({ name: z.string(), content: z.string(), path: z.string().optional() }),
    ),
    async (c) => {
      const projectId = resolveProjectId(c.req.param("id"));
      if (!projectId) return c.json({ error: "Project not found" }, 404);

      const sharedRoot = workspace.sharedDir(projectId);
      const { name, content, path: parentPath } = c.req.valid("json");
      const fullPath = safePath(sharedRoot, join(parentPath ?? "/", name));
      if (!fullPath) return c.json({ error: "Invalid path" }, 400);

      const decoded = Buffer.from(content, "base64");
      await writeFile(fullPath, decoded);
      return c.json({ ok: true }, 201);
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
