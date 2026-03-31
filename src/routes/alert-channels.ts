import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppEnv } from "../types";
import * as alertChannelsService from "../services/alert-channels";
import * as projectsService from "../services/projects";
import { sendTestAlert } from "../services/alert-dispatcher";

const discordConfig = z.object({
  type: z.literal("discord"),
  webhookUrl: z.string().url(),
});

const slackConfig = z.object({
  type: z.literal("slack"),
  webhookUrl: z.string().url(),
});

const telegramConfig = z.object({
  type: z.literal("telegram"),
  botToken: z.string().min(1),
  chatId: z.string().min(1),
});

const alertChannelConfigSchema = z.discriminatedUnion("type", [
  discordConfig,
  slackConfig,
  telegramConfig,
]);

const upsertSchema = z.object({
  config: alertChannelConfigSchema,
  enabled: z.boolean().optional(),
});

export const alertChannelRoutes = new Hono<AppEnv>()
  .get("/projects/:id/alert-channel", (c) => {
    const projectId = c.req.param("id");
    const channel = alertChannelsService.getAlertChannel(projectId);
    if (!channel) return c.json({ error: "No alert channel configured" }, 404);
    return c.json(channel);
  })
  .put("/projects/:id/alert-channel", zValidator("json", upsertSchema), async (c) => {
    const projectId = c.req.param("id");
    const project = projectsService.getProject(projectId);
    if (!project) return c.json({ error: "Project not found" }, 404);
    const body = c.req.valid("json");
    const hadChannel = alertChannelsService.hasAlertChannel(projectId);
    const channel = alertChannelsService.upsertAlertChannel(projectId, body);
    const hasChannel = channel?.enabled ?? false;

    // Restart agents when alert availability changes so they get updated system prompts
    if (hadChannel !== hasChannel) {
      const pm = c.get("projectManager");
      const coordinator = pm.getCoordinator(projectId);
      if (coordinator) {
        await coordinator.restartAllAgents();
      }
    }

    return c.json(channel);
  })
  .delete("/projects/:id/alert-channel", async (c) => {
    const projectId = c.req.param("id");
    const hadChannel = alertChannelsService.hasAlertChannel(projectId);
    alertChannelsService.deleteAlertChannel(projectId);

    // Restart agents when alert channel removed so prompt no longer includes alert instructions
    if (hadChannel) {
      const pm = c.get("projectManager");
      const coordinator = pm.getCoordinator(projectId);
      if (coordinator) {
        await coordinator.restartAllAgents();
      }
    }

    return c.json({ ok: true });
  })
  .post("/projects/:id/alert-channel/test", async (c) => {
    const projectId = c.req.param("id");
    const channel = alertChannelsService.getAlertChannel(projectId);
    if (!channel) return c.json({ error: "No alert channel configured" }, 404);
    const result = await sendTestAlert(channel.config);
    if (!result.ok) return c.json({ error: result.error }, 502);
    return c.json({ ok: true });
  });
