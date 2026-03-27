import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as settings from "../services/workspace-settings";
import * as projectsService from "../services/projects";
import type { AppEnv } from "../types";

function resolveProjectId(nameOrId: string): string | null {
  const byId = projectsService.getProject(nameOrId);
  if (byId) return byId.id;
  const byName = projectsService.getProjectByName(nameOrId);
  return byName?.id ?? null;
}

const contentSchema = z.object({ content: z.string() });

export const settingsRoutes = new Hono<AppEnv>()
  .get("/projects/:id/settings/env", (c) => {
    const projectId = resolveProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Project not found" }, 404);
    return c.json({ content: settings.readEnv(projectId) });
  })
  .put("/projects/:id/settings/env", zValidator("json", contentSchema), (c) => {
    const projectId = resolveProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Project not found" }, 404);
    const { content } = c.req.valid("json");
    settings.writeEnv(projectId, content);
    return c.json({ ok: true });
  })
  .get("/projects/:id/settings/scripts", (c) => {
    const projectId = resolveProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Project not found" }, 404);
    return c.json(settings.readAllScripts(projectId));
  })
  .put("/projects/:id/settings/scripts/:name", zValidator("json", contentSchema), (c) => {
    const projectId = resolveProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Project not found" }, 404);
    const name = c.req.param("name");
    const { content } = c.req.valid("json");
    settings.writeScript(projectId, name, content);
    return c.json({ ok: true });
  })
  .delete("/projects/:id/settings/scripts/:name", (c) => {
    const projectId = resolveProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Project not found" }, 404);
    settings.deleteScript(projectId, c.req.param("name"));
    return c.json({ ok: true });
  })
  .post("/projects/:id/settings/scripts/:name/run", (c) => {
    const projectId = resolveProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Project not found" }, 404);
    const result = settings.runScript(projectId, c.req.param("name"));
    if (result.ok) return c.json({ output: result.output });
    return c.json({ error: result.error }, 500);
  })
  .get("/projects/:id/settings/project-doc", (c) => {
    const projectId = resolveProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Project not found" }, 404);
    return c.json({ content: settings.readProjectDoc(projectId) });
  })
  .put("/projects/:id/settings/project-doc", zValidator("json", contentSchema), (c) => {
    const projectId = resolveProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Project not found" }, 404);
    const { content } = c.req.valid("json");
    settings.writeProjectDoc(projectId, content);
    return c.json({ ok: true });
  });
