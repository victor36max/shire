import { Hono } from "hono";
import { readFile, access, mkdir, writeFile } from "fs/promises";
import { basename } from "path";
import * as workspace from "../services/workspace";
import * as projectsService from "../services/projects";
import { mimeFromPath } from "../utils/mime";
import type { AppEnv } from "../types";

const MAX_FILE_SIZE = 128 * 1024 * 1024; // 128 MB

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export const attachmentRoutes = new Hono<AppEnv>()
  .post("/projects/:id/agents/:aid/attachments", async (c) => {
    const projectIdParam = c.req.param("id");
    const agentId = c.req.param("aid");

    if (
      projectIdParam.includes("..") ||
      projectIdParam.includes("/") ||
      agentId.includes("..") ||
      agentId.includes("/")
    ) {
      return c.json({ error: "Invalid path" }, 400);
    }

    let projectId = projectIdParam;
    const byName = projectsService.getProjectByName(projectIdParam);
    if (byName) projectId = byName.id;

    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      return c.json({ error: "Missing file field" }, 400);
    }

    if (file.size > MAX_FILE_SIZE) {
      return c.json({ error: "File exceeds 128 MB limit" }, 413);
    }

    const safeName = basename(file.name);
    if (!safeName || safeName !== file.name || file.name.includes("..")) {
      return c.json({ error: "Invalid filename" }, 400);
    }

    const attachmentId = `${Date.now()}-${randomSuffix()}`;
    const destDir = workspace.attachmentDir(projectId, agentId, attachmentId);
    await mkdir(destDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    const filePath = workspace.attachmentPath(projectId, agentId, attachmentId, safeName);
    await writeFile(filePath, buffer);

    const contentType = file.type || mimeFromPath(safeName);

    return c.json(
      {
        id: attachmentId,
        filename: safeName,
        content_type: contentType,
        size: buffer.length,
      },
      201,
    );
  })
  .get("/projects/:id/agents/:aid/attachments/:attId/:filename", async (c) => {
    const projectIdParam = c.req.param("id");
    const agentId = c.req.param("aid");
    const attId = c.req.param("attId");
    const filename = c.req.param("filename");

    if (
      filename.includes("..") ||
      filename.includes("/") ||
      attId.includes("..") ||
      agentId.includes("..")
    ) {
      return c.json({ error: "Invalid path" }, 400);
    }

    let projectId = projectIdParam;
    const byName = projectsService.getProjectByName(projectIdParam);
    if (byName) projectId = byName.id;

    const filePath = workspace.attachmentPath(projectId, agentId, attId, filename);

    try {
      await access(filePath);
    } catch {
      return c.json({ error: "Attachment not found" }, 404);
    }

    try {
      const data = await readFile(filePath);
      const contentType = mimeFromPath(filename);
      const isSafeImage = contentType.startsWith("image/") && contentType !== "image/svg+xml";
      const disposition = isSafeImage ? "inline" : "attachment";
      return new Response(data, {
        headers: {
          "Content-Disposition": `${disposition}; filename="${basename(filename)}"`,
          "Content-Type": contentType,
        },
      });
    } catch {
      return c.json({ error: "Failed to read attachment" }, 500);
    }
  });
