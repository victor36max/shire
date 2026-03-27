import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppEnv } from "../types";
import * as agentsService from "../services/agents";

const paginationQuery = z.object({
  before: z.string().optional(),
  limit: z.string().optional(),
});

export const messageRoutes = new Hono<AppEnv>()
  .get("/projects/:id/agents/:aid/messages", zValidator("query", paginationQuery), (c) => {
    const projectId = c.req.param("id");
    const agentId = c.req.param("aid");
    const { before, limit } = c.req.valid("query");

    const result = agentsService.listMessages(projectId, agentId, {
      before: before ? parseInt(before, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    return c.json(result);
  })
  .get("/projects/:id/activity", zValidator("query", paginationQuery), (c) => {
    const projectId = c.req.param("id");
    const { before, limit } = c.req.valid("query");

    const result = agentsService.listInterAgentMessages(projectId, {
      before: before ? parseInt(before, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    return c.json(result);
  });
