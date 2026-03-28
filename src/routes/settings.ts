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
  .get("/projects/:id/settings/project-doc", async (c) => {
    const projectId = resolveProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Project not found" }, 404);
    return c.json({ content: await settings.readProjectDoc(projectId) });
  })
  .put("/projects/:id/settings/project-doc", zValidator("json", contentSchema), async (c) => {
    const projectId = resolveProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Project not found" }, 404);
    const { content } = c.req.valid("json");
    await settings.writeProjectDoc(projectId, content);
    return c.json({ ok: true });
  });
