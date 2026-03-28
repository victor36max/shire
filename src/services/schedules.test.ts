import { describe, it, expect, beforeEach } from "bun:test";
import { useTestDb } from "../test/setup";
import * as schedules from "./schedules";
import * as projects from "./projects";
import * as agents from "./agents";

describe("schedules service", () => {
  useTestDb();

  let projectId: string;
  let agentId: string;

  beforeEach(() => {
    const project = projects.createProject("schedule-project");
    projectId = project.id;
    const agent = agents.createAgent(projectId, { name: "sched-agent" });
    agentId = agent.id;
  });

  describe("createScheduledTask", () => {
    it("creates a recurring task", () => {
      const task = schedules.createScheduledTask({
        label: "Daily check",
        message: "Run daily check",
        scheduleType: "recurring",
        cronExpression: "0 9 * * *",
        projectId,
        agentId,
      });
      expect(task.label).toBe("Daily check");
      expect(task.message).toBe("Run daily check");
      expect(task.scheduleType).toBe("recurring");
      expect(task.cronExpression).toBe("0 9 * * *");
      expect(task.enabled).toBe(true);
    });

    it("creates a one-time task", () => {
      const scheduledAt = new Date(Date.now() + 3600_000).toISOString();
      const task = schedules.createScheduledTask({
        label: "One-time reminder",
        message: "Do this once",
        scheduleType: "once",
        scheduledAt,
        projectId,
        agentId,
      });
      expect(task.label).toBe("One-time reminder");
      expect(task.scheduleType).toBe("once");
      expect(task.scheduledAt).toBe(scheduledAt);
    });
  });

  describe("listScheduledTasks", () => {
    it("returns tasks for a project", () => {
      schedules.createScheduledTask({
        label: "Task A",
        message: "do A",
        scheduleType: "recurring",
        cronExpression: "0 * * * *",
        projectId,
        agentId,
      });
      schedules.createScheduledTask({
        label: "Task B",
        message: "do B",
        scheduleType: "recurring",
        cronExpression: "30 * * * *",
        projectId,
        agentId,
      });

      const tasks = schedules.listScheduledTasks(projectId);
      expect(tasks.length).toBe(2);
      const labels = tasks.map((t) => t.scheduled_tasks.label);
      expect(labels).toContain("Task A");
      expect(labels).toContain("Task B");
    });

    it("does not return tasks from other projects", () => {
      const otherProject = projects.createProject("other-project");
      schedules.createScheduledTask({
        label: "My task",
        message: "mine",
        scheduleType: "recurring",
        cronExpression: "0 * * * *",
        projectId,
        agentId,
      });

      const tasks = schedules.listScheduledTasks(otherProject.id);
      expect(tasks.length).toBe(0);
    });
  });

  describe("updateScheduledTask", () => {
    it("updates a task", () => {
      const task = schedules.createScheduledTask({
        label: "Original",
        message: "original msg",
        scheduleType: "recurring",
        cronExpression: "0 * * * *",
        projectId,
        agentId,
      });

      const updated = schedules.updateScheduledTask(task.id, { label: "Updated" });
      expect(updated?.label).toBe("Updated");
      expect(updated?.message).toBe("original msg");
    });
  });

  describe("deleteScheduledTask", () => {
    it("deletes a task", () => {
      const task = schedules.createScheduledTask({
        label: "Delete me",
        message: "bye",
        scheduleType: "recurring",
        cronExpression: "0 * * * *",
        projectId,
        agentId,
      });

      schedules.deleteScheduledTask(task.id);
      expect(schedules.getScheduledTask(task.id)).toBeUndefined();
    });
  });

  describe("toggleScheduledTask", () => {
    it("toggles enabled to false", () => {
      const task = schedules.createScheduledTask({
        label: "Toggle me",
        message: "toggle",
        scheduleType: "recurring",
        cronExpression: "0 * * * *",
        projectId,
        agentId,
        enabled: true,
      });

      const toggled = schedules.toggleScheduledTask(task.id, false);
      expect(toggled?.enabled).toBe(false);
    });

    it("toggles enabled to true", () => {
      const task = schedules.createScheduledTask({
        label: "Toggle me",
        message: "toggle",
        scheduleType: "recurring",
        cronExpression: "0 * * * *",
        projectId,
        agentId,
        enabled: false,
      });

      const toggled = schedules.toggleScheduledTask(task.id, true);
      expect(toggled?.enabled).toBe(true);
    });
  });

  describe("markRun", () => {
    it("sets last_run_at", () => {
      const task = schedules.createScheduledTask({
        label: "Run me",
        message: "run",
        scheduleType: "recurring",
        cronExpression: "0 * * * *",
        projectId,
        agentId,
      });

      expect(task.lastRunAt).toBeNull();
      const updated = schedules.markRun(task.id);
      expect(updated?.lastRunAt).toBeTruthy();
    });
  });
});
