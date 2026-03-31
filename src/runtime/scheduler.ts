import schedule from "node-schedule";
import { bus } from "../events";
import { getDb } from "../db";
import * as schedulesService from "../services/schedules";
import * as agentsService from "../services/agents";
import type { ProjectManager } from "./project-manager";

export class Scheduler {
  private jobs = new Map<string, schedule.Job>();
  private projectManager: ProjectManager;

  constructor(projectManager: ProjectManager) {
    this.projectManager = projectManager;
  }

  boot(): void {
    const tasks = schedulesService.listEnabledTasks();
    for (const row of tasks) {
      this.scheduleTask(row.scheduled_tasks);
    }
    console.log(`Scheduler: loaded ${tasks.length} enabled task(s)`);
  }

  scheduleTask(task: {
    id: string;
    projectId: string;
    agentId: string;
    label: string;
    message: string;
    scheduleType: "once" | "recurring";
    cronExpression: string | null;
    scheduledAt: string | null;
    enabled: boolean;
  }): void {
    this.cancelTask(task.id);

    if (!task.enabled) return;

    const callback = () => this.fireTask(task);

    if (task.scheduleType === "recurring" && task.cronExpression) {
      const job = schedule.scheduleJob({ rule: task.cronExpression, tz: "Etc/UTC" }, callback);
      if (job) this.jobs.set(task.id, job);
    } else if (task.scheduleType === "once" && task.scheduledAt) {
      const date = new Date(task.scheduledAt);
      if (date > new Date()) {
        const job = schedule.scheduleJob(date, callback);
        if (job) this.jobs.set(task.id, job);
      }
    }
  }

  cancelTask(taskId: string): void {
    const job = this.jobs.get(taskId);
    if (job) {
      job.cancel();
      this.jobs.delete(taskId);
    }
  }

  cancelAll(): void {
    for (const job of this.jobs.values()) {
      job.cancel();
    }
    this.jobs.clear();
  }

  private fireTask(task: {
    id: string;
    projectId: string;
    agentId: string;
    label: string;
    message: string;
    scheduleType: "once" | "recurring";
  }): void {
    const coordinator = this.projectManager.getCoordinator(task.projectId);
    if (!coordinator) {
      console.warn(`Scheduler: no coordinator for project ${task.projectId}`);
      return;
    }

    const agent = coordinator.getAgent(task.agentId);
    if (!agent) {
      console.warn(`Scheduler: agent ${task.agentId} not found`);
      return;
    }

    const messageText = `[Scheduled: ${task.label}] ${task.message}`;

    // Send as system message (side effect, stays outside transaction)
    agent.sendMessage(messageText, "system");

    // Persist log entry + mark run + disable one-time tasks atomically
    try {
      getDb().transaction((tx) => {
        agentsService.createMessage(
          {
            projectId: task.projectId,
            agentId: task.agentId,
            role: "system",
            content: {
              text: messageText,
              trigger: "scheduled_task",
              taskLabel: task.label,
              taskId: task.id,
            },
          },
          tx,
        );

        schedulesService.markRun(task.id, tx);

        if (task.scheduleType === "once") {
          schedulesService.toggleScheduledTask(task.id, false, tx);
        }
      });
    } catch (err) {
      console.error(`Scheduler: failed to persist fireTask for task ${task.id}:`, err);
    }

    // Cancel in-memory job for one-time tasks (stays outside transaction)
    if (task.scheduleType === "once") {
      this.cancelTask(task.id);
    }

    bus.emit(`project:${task.projectId}:schedules`, {
      type: "schedule_fired",
      payload: { taskId: task.id },
    });
  }
}
