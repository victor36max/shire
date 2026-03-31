import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppEnv } from "../types";
import * as alertChannelsService from "../services/alert-channels";
import * as projectsService from "../services/projects";
import { sendTestAlert } from "../services/alert-dispatcher";
import { CHANNEL_TYPES } from "../db/schema";

const channelTypeEnum = z.enum(CHANNEL_TYPES as [string, ...string[]]);

const upsertSchema = z
  .object({
    channelType: channelTypeEnum,
    webhookUrl: z.string().min(1),
    chatId: z.string().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((data) => data.channelType !== "telegram" || !!data.chatId, {
    message: "Telegram channels require a chatId",
  });

export const alertChannelRoutes = new Hono<AppEnv>()
  .get("/projects/:id/alert-channel", (c) => {
    const projectId = c.req.param("id");
    const channel = alertChannelsService.getAlertChannel(projectId);
    if (!channel) return c.json({ error: "No alert channel configured" }, 404);
    return c.json(channel);
  })
  .put("/projects/:id/alert-channel", zValidator("json", upsertSchema), (c) => {
    const projectId = c.req.param("id");
    const project = projectsService.getProject(projectId);
    if (!project) return c.json({ error: "Project not found" }, 404);
    const body = c.req.valid("json");
    const channel = alertChannelsService.upsertAlertChannel(projectId, {
      ...body,
      channelType: body.channelType as "discord" | "slack" | "telegram",
    });
    return c.json(channel);
  })
  .delete("/projects/:id/alert-channel", (c) => {
    const projectId = c.req.param("id");
    alertChannelsService.deleteAlertChannel(projectId);
    return c.json({ ok: true });
  })
  .post("/projects/:id/alert-channel/test", async (c) => {
    const projectId = c.req.param("id");
    const channel = alertChannelsService.getAlertChannel(projectId);
    if (!channel) return c.json({ error: "No alert channel configured" }, 404);
    const result = await sendTestAlert(channel);
    if (!result.ok) return c.json({ error: result.error }, 502);
    return c.json({ ok: true });
  });
