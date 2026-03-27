import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as catalog from "../services/catalog";
import type { AppEnv } from "../types";

export const catalogRoutes = new Hono<AppEnv>()
  .get(
    "/catalog/agents",
    zValidator("query", z.object({ category: z.string().optional() })),
    (c) => {
      const { category } = c.req.valid("query");
      return c.json(catalog.listAgents(category ?? undefined));
    },
  )
  .get("/catalog/agents/:name", (c) => {
    const agent = catalog.getAgent(c.req.param("name"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    return c.json(agent);
  })
  .get("/catalog/categories", (c) => {
    return c.json(catalog.listCategories());
  });
