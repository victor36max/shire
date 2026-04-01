import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { readdir, stat } from "fs/promises";
import * as workspace from "../services/workspace";
import { mimeFromPath } from "../utils/mime";
import type { AppEnv } from "../types";

const skillSchema = z.object({
  name: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "Invalid skill name"),
  description: z.string(),
  content: z.string(),
  references: z
    .array(
      z.object({
        name: z.string().regex(/^[^/\\]+$/, "Invalid reference filename"),
        content: z.string(),
      }),
    )
    .optional(),
});

export const agentRoutes = new Hono<AppEnv>()
  .get("/projects/:id/agents", (c) => {
    const pm = c.get("projectManager");
    const coordinator = pm.getCoordinator(c.req.param("id"));
    if (!coordinator) return c.json({ error: "Project not found" }, 404);
    return c.json(coordinator.listAgentStatuses());
  })
  .post(
    "/projects/:id/agents",
    zValidator(
      "json",
      z.object({
        name: z.string(),
        description: z.string().optional(),
        harness: z.enum(["claude_code", "pi", "opencode"]).optional(),
        model: z.string().optional(),
        systemPrompt: z.string().optional(),
        skills: z.array(skillSchema).optional(),
      }),
    ),
    async (c) => {
      const pm = c.get("projectManager");
      const coordinator = pm.getCoordinator(c.req.param("id"));
      if (!coordinator) return c.json({ error: "Project not found" }, 404);

      const params = c.req.valid("json");
      const result = await coordinator.createAgent(params);
      if (!result.ok) return c.json({ error: result.error }, 422);
      return c.json({ id: result.agentId }, 201);
    },
  )
  .get("/projects/:id/agents/:aid", async (c) => {
    const pm = c.get("projectManager");
    const coordinator = pm.getCoordinator(c.req.param("id"));
    if (!coordinator) return c.json({ error: "Project not found" }, 404);

    const detail = await coordinator.getAgentDetail(c.req.param("aid"));
    if (!detail) return c.json({ error: "Agent not found" }, 404);
    return c.json(detail);
  })
  .patch(
    "/projects/:id/agents/:aid",
    zValidator(
      "json",
      z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        harness: z.enum(["claude_code", "pi", "opencode"]).optional(),
        model: z.string().optional(),
        systemPrompt: z.string().optional(),
        skills: z.array(skillSchema).optional(),
      }),
    ),
    async (c) => {
      const pm = c.get("projectManager");
      const coordinator = pm.getCoordinator(c.req.param("id"));
      if (!coordinator) return c.json({ error: "Project not found" }, 404);

      const params = c.req.valid("json");
      const result = await coordinator.updateAgent(c.req.param("aid"), params);
      if (!result.ok) return c.json({ error: result.error }, 422);
      return c.json({ ok: true });
    },
  )
  .delete("/projects/:id/agents/:aid", async (c) => {
    const pm = c.get("projectManager");
    const coordinator = pm.getCoordinator(c.req.param("id"));
    if (!coordinator) return c.json({ error: "Project not found" }, 404);

    const result = await coordinator.deleteAgent(c.req.param("aid"));
    if (!result.ok) return c.json({ error: result.error }, 500);
    return c.json({ ok: true });
  })
  .post("/projects/:id/agents/:aid/restart", async (c) => {
    const pm = c.get("projectManager");
    const coordinator = pm.getCoordinator(c.req.param("id"));
    if (!coordinator) return c.json({ error: "Project not found" }, 404);

    const ok = await coordinator.restartAgent(c.req.param("aid"));
    if (!ok) return c.json({ error: "Agent not found" }, 404);
    return c.json({ ok: true });
  })
  .post(
    "/projects/:id/agents/:aid/message",
    zValidator(
      "json",
      z.object({
        text: z.string(),
        attachmentIds: z.array(z.string()).optional(),
      }),
    ),
    async (c) => {
      const pm = c.get("projectManager");
      const coordinator = pm.getCoordinator(c.req.param("id"));
      if (!coordinator) return c.json({ error: "Project not found" }, 404);

      const agentMgr = coordinator.getAgent(c.req.param("aid"));
      if (!agentMgr) return c.json({ error: "Agent not found" }, 404);

      const { text, attachmentIds } = c.req.valid("json");

      // Resolve attachment IDs to metadata — files are already on disk
      const attachments: Array<{
        id: string;
        filename: string;
        content_type: string;
        size: number;
      }> = [];

      if (attachmentIds && attachmentIds.length > 0) {
        const projectId = coordinator.projectId;
        const agentId = c.req.param("aid");

        for (const attId of attachmentIds) {
          if (attId.includes("..") || attId.includes("/")) {
            return c.json({ error: `Invalid attachment ID: ${attId}` }, 400);
          }
          const dir = workspace.attachmentDir(projectId, agentId, attId);
          let files: string[];
          try {
            const entries = await readdir(dir);
            files = entries.filter((f) => !f.startsWith("."));
          } catch {
            return c.json({ error: `Attachment not found: ${attId}` }, 404);
          }
          if (files.length === 0) {
            return c.json({ error: `Attachment empty: ${attId}` }, 404);
          }
          const filename = files[0];
          const filePath = workspace.attachmentPath(projectId, agentId, attId, filename);
          const fileStat = await stat(filePath);
          attachments.push({
            id: attId,
            filename,
            content_type: mimeFromPath(filename),
            size: fileStat.size,
          });
        }
      }

      const result = await agentMgr.sendMessage(text, "user", {
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      if (!result.ok) return c.json({ error: result.error }, 422);
      return c.json({ ok: true, message: result.message });
    },
  )
  .post("/projects/:id/agents/:aid/interrupt", async (c) => {
    const pm = c.get("projectManager");
    const coordinator = pm.getCoordinator(c.req.param("id"));
    if (!coordinator) return c.json({ error: "Project not found" }, 404);

    const agent = coordinator.getAgent(c.req.param("aid"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);

    const ok = await agent.interrupt();
    if (!ok) return c.json({ error: "Agent not active" }, 422);
    return c.json({ ok: true });
  })
  .post(
    "/projects/:id/agents/:aid/mark-read",
    zValidator("json", z.object({ messageId: z.number() })),
    (c) => {
      const pm = c.get("projectManager");
      const coordinator = pm.getCoordinator(c.req.param("id"));
      if (!coordinator) return c.json({ error: "Project not found" }, 404);

      const agent = coordinator.getAgent(c.req.param("aid"));
      if (!agent) return c.json({ error: "Agent not found" }, 404);

      const { messageId } = c.req.valid("json");
      agent.markRead(messageId);
      return c.json({ ok: true });
    },
  )
  .post("/projects/:id/agents/:aid/clear", async (c) => {
    const pm = c.get("projectManager");
    const coordinator = pm.getCoordinator(c.req.param("id"));
    if (!coordinator) return c.json({ error: "Project not found" }, 404);

    const agent = coordinator.getAgent(c.req.param("aid"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);

    const ok = await agent.clearSession();
    if (!ok) return c.json({ error: "Agent not active" }, 422);
    return c.json({ ok: true });
  });
