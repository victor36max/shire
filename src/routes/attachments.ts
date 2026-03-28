import { Hono } from "hono";
import { readFile, access } from "fs/promises";
import { basename } from "path";
import * as workspace from "../services/workspace";
import * as projectsService from "../services/projects";
import type { AppEnv } from "../types";

export const attachmentRoutes = new Hono<AppEnv>().get(
  "/projects/:id/agents/:aid/attachments/:attId/:filename",
  async (c) => {
    const projectIdParam = c.req.param("id");
    const agentId = c.req.param("aid");
    const attId = c.req.param("attId");
    const filename = c.req.param("filename");

    if (filename.includes("..") || filename.includes("/") || attId.includes("..")) {
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
      return new Response(data, {
        headers: {
          "Content-Disposition": `attachment; filename="${basename(filename)}"`,
          "Content-Type": "application/octet-stream",
        },
      });
    } catch {
      return c.json({ error: "Failed to read attachment" }, 500);
    }
  },
);
