import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppEnv } from "../types";

export const projectRoutes = new Hono<AppEnv>()
  .get("/projects", (c) => {
    const pm = c.get("projectManager");
    return c.json(pm.listProjects());
  })
  .post("/projects", zValidator("json", z.object({ name: z.string() })), async (c) => {
    const pm = c.get("projectManager");
    const { name } = c.req.valid("json");
    const result = await pm.createProject(name);
    if (!result.ok) return c.json({ error: result.error }, 422);
    return c.json(result.project, 201);
  })
  .patch("/projects/:id", zValidator("json", z.object({ name: z.string() })), async (c) => {
    const pm = c.get("projectManager");
    const id = c.req.param("id");
    const { name } = c.req.valid("json");
    const result = pm.renameProject(id, name);
    if (!result) return c.json({ error: "Project not found" }, 404);
    return c.json(result);
  })
  .delete("/projects/:id", async (c) => {
    const pm = c.get("projectManager");
    const id = c.req.param("id");
    const result = await pm.destroyProject(id);
    if (!result.ok) return c.json({ error: result.error }, 500);
    return c.json({ ok: true });
  })
  .post("/projects/:id/restart", async (c) => {
    const pm = c.get("projectManager");
    const id = c.req.param("id");
    await pm.restartProject(id);
    return c.json({ ok: true });
  });
