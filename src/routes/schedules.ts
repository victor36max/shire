import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppEnv } from "../types";
import * as schedulesService from "../services/schedules";

// Basic cron expression validation: 5 or 6 space-separated fields
const CRON_REGEX = /^(\S+\s+){4,5}\S+$/;

const cronString = z.string().refine((v) => CRON_REGEX.test(v.trim()), {
  message: "Invalid cron expression: must be 5 or 6 space-separated fields",
});

const dateString = z.string().refine((v) => !isNaN(new Date(v).getTime()), {
  message: "Invalid date: must be a valid ISO 8601 date string",
});

const scheduleFieldsSchema = z.object({
  agentId: z.string(),
  label: z.string(),
  message: z.string(),
  scheduleType: z.enum(["once", "recurring"]),
  cronExpression: cronString.optional(),
  scheduledAt: dateString.optional(),
  enabled: z.boolean().optional(),
});

const createScheduleSchema = scheduleFieldsSchema.refine(
  (data) => {
    if (data.scheduleType === "recurring" && !data.cronExpression) return false;
    if (data.scheduleType === "once" && !data.scheduledAt) return false;
    return true;
  },
  {
    message: "Recurring schedules require cronExpression; one-time schedules require scheduledAt",
  },
);

const updateScheduleSchema = z.object({
  agentId: z.string().optional(),
  label: z.string().optional(),
  message: z.string().optional(),
  scheduleType: z.enum(["once", "recurring"]).optional(),
  cronExpression: cronString.optional(),
  scheduledAt: dateString.optional(),
  enabled: z.boolean().optional(),
});

export const scheduleRoutes = new Hono<AppEnv>()
  .get("/projects/:id/schedules", (c) => {
    const projectId = c.req.param("id");
    return c.json(schedulesService.listScheduledTasks(projectId));
  })
  .post("/projects/:id/schedules", zValidator("json", createScheduleSchema), (c) => {
    const scheduler = c.get("scheduler");
    const body = c.req.valid("json");
    const projectId = c.req.param("id");

    const task = schedulesService.createScheduledTask({ ...body, projectId });
    scheduler.scheduleTask(task);
    return c.json(task, 201);
  })
  .patch("/projects/:id/schedules/:sid", zValidator("json", updateScheduleSchema), (c) => {
    const scheduler = c.get("scheduler");
    const sid = c.req.param("sid");
    const body = c.req.valid("json");

    const task = schedulesService.updateScheduledTask(sid, body);
    if (!task) return c.json({ error: "Task not found" }, 404);

    scheduler.scheduleTask(task);
    return c.json(task);
  })
  .delete("/projects/:id/schedules/:sid", (c) => {
    const scheduler = c.get("scheduler");
    const sid = c.req.param("sid");

    schedulesService.deleteScheduledTask(sid);
    scheduler.cancelTask(sid);
    return c.json({ ok: true });
  })
  .post(
    "/projects/:id/schedules/:sid/toggle",
    zValidator("json", z.object({ enabled: z.boolean() })),
    (c) => {
      const scheduler = c.get("scheduler");
      const sid = c.req.param("sid");
      const { enabled } = c.req.valid("json");

      const task = schedulesService.toggleScheduledTask(sid, enabled);
      if (!task) return c.json({ error: "Task not found" }, 404);

      if (enabled) {
        scheduler.scheduleTask(task);
      } else {
        scheduler.cancelTask(sid);
      }

      return c.json(task);
    },
  )
  .post("/projects/:id/schedules/:sid/run", (c) => {
    const pm = c.get("projectManager");
    const sid = c.req.param("sid");

    const row = schedulesService.getScheduledTask(sid);
    if (!row) return c.json({ error: "Task not found" }, 404);

    const task = row.scheduled_tasks;
    const coordinator = pm.getCoordinator(task.projectId);
    if (!coordinator) return c.json({ error: "Project not found" }, 404);

    const agent = coordinator.getAgent(task.agentId);
    if (!agent) return c.json({ error: "Agent not found" }, 404);

    agent.sendMessage(`[Scheduled: ${task.label}] ${task.message}`, "system");
    schedulesService.markRun(sid);

    return c.json({ ok: true });
  });
