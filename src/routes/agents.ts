import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppEnv } from "../types";

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
        harness: z.enum(["claude_code", "pi"]).optional(),
        model: z.string().optional(),
        systemPrompt: z.string().optional(),
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
        harness: z.enum(["claude_code", "pi"]).optional(),
        model: z.string().optional(),
        systemPrompt: z.string().optional(),
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
        attachments: z
          .array(
            z.object({
              name: z.string().regex(/^[^/\\]+$/, "Filename must not contain path separators"),
              content: z.string(),
              content_type: z.string(),
            }),
          )
          .optional(),
      }),
    ),
    async (c) => {
      const pm = c.get("projectManager");
      const coordinator = pm.getCoordinator(c.req.param("id"));
      if (!coordinator) return c.json({ error: "Project not found" }, 404);

      const agent = coordinator.getAgent(c.req.param("aid"));
      if (!agent) return c.json({ error: "Agent not found" }, 404);

      const { text, attachments } = c.req.valid("json");
      const result = await agent.sendMessage(text, "user", { attachments });
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
