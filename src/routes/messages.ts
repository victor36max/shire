import { Hono } from "hono";
import type { AppEnv } from "../types";
import * as agentsService from "../services/agents";

export const messageRoutes = new Hono<AppEnv>()
  .get("/projects/:id/agents/:aid/messages", (c) => {
    const projectId = c.req.param("id");
    const agentId = c.req.param("aid");
    const before = c.req.query("before");
    const limit = c.req.query("limit");

    const result = agentsService.listMessages(projectId, agentId, {
      before: before ? parseInt(before, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    return c.json(result);
  })
  .get("/projects/:id/activity", (c) => {
    const projectId = c.req.param("id");
    const before = c.req.query("before");
    const limit = c.req.query("limit");

    const result = agentsService.listInterAgentMessages(projectId, {
      before: before ? parseInt(before, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    return c.json(result);
  });
