import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppEnv } from "../types";
import * as agentsService from "../services/agents";

const MAX_PAGE_SIZE = 200;

const paginationQuery = z.object({
  before: z
    .string()
    .optional()
    .refine((v) => !v || (!isNaN(parseInt(v, 10)) && parseInt(v, 10) > 0), {
      message: "before must be a positive integer",
    }),
  limit: z
    .string()
    .optional()
    .refine((v) => !v || (!isNaN(parseInt(v, 10)) && parseInt(v, 10) > 0), {
      message: "limit must be a positive integer",
    }),
});

export const messageRoutes = new Hono<AppEnv>()
  .get("/projects/:id/agents/:aid/messages", zValidator("query", paginationQuery), (c) => {
    const projectId = c.req.param("id");
    const agentId = c.req.param("aid");
    const { before, limit } = c.req.valid("query");

    const result = agentsService.listMessages(projectId, agentId, {
      before: before ? parseInt(before, 10) : undefined,
      limit: limit ? Math.min(parseInt(limit, 10), MAX_PAGE_SIZE) : undefined,
    });

    return c.json(result);
  })
  .get("/projects/:id/activity", zValidator("query", paginationQuery), (c) => {
    const projectId = c.req.param("id");
    const { before, limit } = c.req.valid("query");

    const result = agentsService.listInterAgentMessages(projectId, {
      before: before ? parseInt(before, 10) : undefined,
      limit: limit ? Math.min(parseInt(limit, 10), MAX_PAGE_SIZE) : undefined,
    });

    const messages = result.messages.map((row) => {
      const { content } = row;
      return {
        id: row.id,
        role: row.role,
        text: String(content.text ?? ""),
        fromAgent: String(content.fromAgent ?? content.from_agent ?? ""),
        toAgent: String(content.toAgent ?? content.to_agent ?? ""),
        ts: row.createdAt,
        ...(content.trigger ? { trigger: String(content.trigger) } : {}),
        ...(content.taskLabel != null || content.task_label != null
          ? { taskLabel: String(content.taskLabel ?? content.task_label) }
          : {}),
      };
    });

    return c.json({ messages, hasMore: result.hasMore });
  });
