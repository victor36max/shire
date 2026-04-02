import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test";
import { createTestDb } from "../test/setup";
import { Scheduler } from "./scheduler";
import * as projects from "../services/projects";
import * as agentsService from "../services/agents";
import * as schedulesService from "../services/schedules";
import { bus, type BusEvent } from "../events";
import type { ProjectManager } from "./project-manager";
import type { Coordinator } from "./coordinator";
import type { AgentManager } from "./agent-manager";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockAgent(overrides?: Partial<AgentManager>): AgentManager {
  return {
    sendMessage: mock(() => Promise.resolve({ ok: true })),
    ...overrides,
  } as unknown as AgentManager;
}

function makeMockCoordinator(agents: Map<string, AgentManager> = new Map()): Coordinator {
  return {
    getAgent: (id: string) => agents.get(id),
  } as unknown as Coordinator;
}

function makeMockProjectManager(
  coordinators: Map<string, Coordinator> = new Map(),
): ProjectManager {
  return {
    getCoordinator: (id: string) => coordinators.get(id),
  } as unknown as ProjectManager;
}

function collectEvents(topic: string): { events: BusEvent[]; unsub: () => void } {
  const events: BusEvent[] = [];
  const unsub = bus.on(topic, (e) => events.push(e));
  return { events, unsub };
}

interface TaskInput {
  id?: string;
  projectId?: string;
  agentId?: string;
  label?: string;
  message?: string;
  scheduleType?: "once" | "recurring";
  cronExpression?: string | null;
  scheduledAt?: string | null;
  enabled?: boolean;
}

function makeTask(overrides: TaskInput = {}) {
  return {
    id: overrides.id ?? "task-1",
    projectId: overrides.projectId ?? "proj-1",
    agentId: overrides.agentId ?? "agent-1",
    label: overrides.label ?? "Test Task",
    message: overrides.message ?? "do something",
    scheduleType: overrides.scheduleType ?? ("recurring" as const),
    cronExpression: overrides.cronExpression ?? "*/5 * * * *",
    scheduledAt: overrides.scheduledAt ?? null,
    enabled: overrides.enabled ?? true,
  };
}

// ── Mock node-schedule ───────────────────────────────────────────────────────

const mockJobs = new Map<string, { cancel: ReturnType<typeof mock> }>();

mock.module("node-schedule", () => ({
  default: {
    scheduleJob: mock((_spec: unknown, callback: () => void) => {
      const job = { cancel: mock(() => {}), _callback: callback };
      // Store by a key so tests can inspect; we'll also capture the callback
      const key = `job-${mockJobs.size}`;
      mockJobs.set(key, job);
      return job;
    }),
  },
}));

// Re-import after mocking
const nodeSchedule = (await import("node-schedule")).default;

// ── Tests ────────────────────────────────────────────────────────────────────

let projectId: string;
let agentId: string;

beforeEach(() => {
  createTestDb();
  mockJobs.clear();
  (nodeSchedule.scheduleJob as ReturnType<typeof mock>).mockClear();

  const project = projects.createProject("sched-test");
  projectId = project.id;
  const agent = agentsService.createAgent(projectId, { name: "sched-agent" });
  agentId = agent.id;
});

describe("Scheduler", () => {
  describe("boot", () => {
    it("loads enabled tasks from the database", () => {
      // Create two enabled tasks and one disabled
      schedulesService.createScheduledTask({
        projectId,
        agentId,
        label: "Task A",
        message: "run A",
        scheduleType: "recurring",
        cronExpression: "*/10 * * * *",
        enabled: true,
      });
      schedulesService.createScheduledTask({
        projectId,
        agentId,
        label: "Task B",
        message: "run B",
        scheduleType: "recurring",
        cronExpression: "0 * * * *",
        enabled: true,
      });
      schedulesService.createScheduledTask({
        projectId,
        agentId,
        label: "Disabled",
        message: "nope",
        scheduleType: "recurring",
        cronExpression: "0 0 * * *",
        enabled: false,
      });

      const scheduler = new Scheduler(makeMockProjectManager());
      scheduler.boot();

      // Two enabled tasks should have produced two scheduleJob calls
      expect(nodeSchedule.scheduleJob).toHaveBeenCalledTimes(2);
    });

    it("loads zero tasks when none are enabled", () => {
      schedulesService.createScheduledTask({
        projectId,
        agentId,
        label: "Off",
        message: "off",
        scheduleType: "recurring",
        cronExpression: "0 0 * * *",
        enabled: false,
      });

      const scheduler = new Scheduler(makeMockProjectManager());
      scheduler.boot();

      expect(nodeSchedule.scheduleJob).toHaveBeenCalledTimes(0);
    });
  });

  describe("scheduleTask", () => {
    it("registers a recurring task with cron expression", () => {
      const scheduler = new Scheduler(makeMockProjectManager());
      const task = makeTask({
        scheduleType: "recurring",
        cronExpression: "*/5 * * * *",
        enabled: true,
      });

      scheduler.scheduleTask(task);

      expect(nodeSchedule.scheduleJob).toHaveBeenCalledTimes(1);
      const call = (nodeSchedule.scheduleJob as ReturnType<typeof mock>).mock.calls[0];
      expect(call[0]).toEqual({ rule: "*/5 * * * *", tz: "Etc/UTC" });
    });

    it("registers a one-time task with a future date", () => {
      const scheduler = new Scheduler(makeMockProjectManager());
      const futureDate = new Date(Date.now() + 60_000).toISOString();
      const task = makeTask({
        scheduleType: "once",
        cronExpression: null,
        scheduledAt: futureDate,
        enabled: true,
      });

      scheduler.scheduleTask(task);

      expect(nodeSchedule.scheduleJob).toHaveBeenCalledTimes(1);
      const call = (nodeSchedule.scheduleJob as ReturnType<typeof mock>).mock.calls[0];
      // For "once" tasks, the first arg is a Date
      expect(call[0] instanceof Date).toBe(true);
    });

    it("does not register a one-time task with a past date", () => {
      const scheduler = new Scheduler(makeMockProjectManager());
      const pastDate = new Date(Date.now() - 60_000).toISOString();
      const task = makeTask({
        scheduleType: "once",
        cronExpression: null,
        scheduledAt: pastDate,
        enabled: true,
      });

      scheduler.scheduleTask(task);

      expect(nodeSchedule.scheduleJob).toHaveBeenCalledTimes(0);
    });

    it("does not register a disabled task", () => {
      const scheduler = new Scheduler(makeMockProjectManager());
      const task = makeTask({ enabled: false });

      scheduler.scheduleTask(task);

      expect(nodeSchedule.scheduleJob).toHaveBeenCalledTimes(0);
    });

    it("cancels existing job before rescheduling same task id", () => {
      const scheduler = new Scheduler(makeMockProjectManager());
      const task = makeTask({ id: "task-resched", enabled: true });

      scheduler.scheduleTask(task);
      const firstJob = [...mockJobs.values()][0];

      scheduler.scheduleTask(task);

      // The first job should have been cancelled
      expect(firstJob.cancel).toHaveBeenCalledTimes(1);
      // Two scheduleJob calls total (first + rescheduled)
      expect(nodeSchedule.scheduleJob).toHaveBeenCalledTimes(2);
    });
  });

  describe("cancelTask", () => {
    it("cancels and removes a scheduled job", () => {
      const scheduler = new Scheduler(makeMockProjectManager());
      const task = makeTask({ id: "cancel-me" });

      scheduler.scheduleTask(task);
      const job = [...mockJobs.values()][0];

      scheduler.cancelTask("cancel-me");

      expect(job.cancel).toHaveBeenCalledTimes(1);
    });

    it("is a no-op for unknown task ids", () => {
      const scheduler = new Scheduler(makeMockProjectManager());
      // Should not throw
      scheduler.cancelTask("nonexistent");
    });
  });

  describe("cancelAll", () => {
    it("cancels all scheduled jobs and clears the map", () => {
      const scheduler = new Scheduler(makeMockProjectManager());

      scheduler.scheduleTask(makeTask({ id: "t1" }));
      scheduler.scheduleTask(makeTask({ id: "t2" }));
      scheduler.scheduleTask(makeTask({ id: "t3" }));

      const allJobs = [...mockJobs.values()];

      scheduler.cancelAll();

      for (const job of allJobs) {
        expect(job.cancel).toHaveBeenCalled();
      }

      // After cancelAll, cancelling individual tasks should be a no-op (jobs already removed)
      scheduler.cancelTask("t1");
      // No additional cancel calls on the already-cancelled jobs
    });
  });

  describe("fireTask", () => {
    it("sends message to agent and emits schedule_fired event", () => {
      const mockAgent = makeMockAgent();
      const agents = new Map<string, AgentManager>();
      agents.set(agentId, mockAgent);
      const coord = makeMockCoordinator(agents);
      const coordinators = new Map<string, Coordinator>();
      coordinators.set(projectId, coord);
      const pm = makeMockProjectManager(coordinators);

      // We need a real task in DB for markRun/toggleScheduledTask
      const dbTask = schedulesService.createScheduledTask({
        projectId,
        agentId,
        label: "Fire Test",
        message: "hello scheduled",
        scheduleType: "recurring",
        cronExpression: "*/5 * * * *",
        enabled: true,
      });

      const scheduler = new Scheduler(pm);
      const task = makeTask({
        id: dbTask.id,
        projectId,
        agentId,
        label: "Fire Test",
        message: "hello scheduled",
        scheduleType: "recurring",
      });

      // Capture the callback by scheduling the task
      scheduler.scheduleTask(task);
      const job = [...mockJobs.values()][0];
      const callback = (job as unknown as Record<string, () => void>)._callback;

      const { events, unsub } = collectEvents(`project:${projectId}:schedules`);

      // Fire the task by invoking the callback
      callback();
      unsub();

      // Agent should have received the message
      expect(mockAgent.sendMessage).toHaveBeenCalledTimes(1);
      const sentMsg = (mockAgent.sendMessage as ReturnType<typeof mock>).mock.calls[0][0];
      expect(sentMsg).toContain("[Scheduled: Fire Test]");
      expect(sentMsg).toContain("hello scheduled");

      // Should have emitted schedule_fired event
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("schedule_fired");
      expect((events[0] as { payload: { taskId: string } }).payload.taskId).toBe(dbTask.id);
    });

    it("persists a system message in the database when task fires", () => {
      const mockAgent = makeMockAgent();
      const agents = new Map<string, AgentManager>();
      agents.set(agentId, mockAgent);
      const coord = makeMockCoordinator(agents);
      const coordinators = new Map<string, Coordinator>();
      coordinators.set(projectId, coord);
      const pm = makeMockProjectManager(coordinators);

      const dbTask = schedulesService.createScheduledTask({
        projectId,
        agentId,
        label: "Persist Test",
        message: "persist me",
        scheduleType: "recurring",
        cronExpression: "*/5 * * * *",
        enabled: true,
      });

      const scheduler = new Scheduler(pm);
      const task = makeTask({
        id: dbTask.id,
        projectId,
        agentId,
        label: "Persist Test",
        message: "persist me",
        scheduleType: "recurring",
      });

      scheduler.scheduleTask(task);
      const job = [...mockJobs.values()][0];
      const callback = (job as unknown as Record<string, () => void>)._callback;
      callback();

      // Check that a system message was persisted
      const { messages } = agentsService.listMessages(projectId, agentId);
      const systemMsgs = messages.filter((m) => m.role === "system");
      expect(systemMsgs.length).toBe(1);
      const content = systemMsgs[0].content as Record<string, unknown>;
      expect(content.trigger).toBe("scheduled_task");
      expect(content.taskLabel).toBe("Persist Test");
    });

    it("marks lastRunAt on the task after firing", () => {
      const mockAgent = makeMockAgent();
      const agents = new Map<string, AgentManager>();
      agents.set(agentId, mockAgent);
      const coord = makeMockCoordinator(agents);
      const coordinators = new Map<string, Coordinator>();
      coordinators.set(projectId, coord);
      const pm = makeMockProjectManager(coordinators);

      const dbTask = schedulesService.createScheduledTask({
        projectId,
        agentId,
        label: "Run Mark",
        message: "mark me",
        scheduleType: "recurring",
        cronExpression: "*/5 * * * *",
        enabled: true,
      });

      const scheduler = new Scheduler(pm);
      const task = makeTask({
        id: dbTask.id,
        projectId,
        agentId,
        label: "Run Mark",
        message: "mark me",
        scheduleType: "recurring",
      });

      scheduler.scheduleTask(task);
      const job = [...mockJobs.values()][0];
      const callback = (job as unknown as Record<string, () => void>)._callback;
      callback();

      const updated = schedulesService.getScheduledTask(dbTask.id);
      expect(updated).toBeDefined();
      expect(updated!.scheduled_tasks.lastRunAt).not.toBeNull();
    });

    it("disables and cancels a one-time task after firing", () => {
      const mockAgent = makeMockAgent();
      const agents = new Map<string, AgentManager>();
      agents.set(agentId, mockAgent);
      const coord = makeMockCoordinator(agents);
      const coordinators = new Map<string, Coordinator>();
      coordinators.set(projectId, coord);
      const pm = makeMockProjectManager(coordinators);

      const futureDate = new Date(Date.now() + 60_000).toISOString();
      const dbTask = schedulesService.createScheduledTask({
        projectId,
        agentId,
        label: "One Shot",
        message: "once only",
        scheduleType: "once",
        scheduledAt: futureDate,
        enabled: true,
      });

      const scheduler = new Scheduler(pm);
      const task = makeTask({
        id: dbTask.id,
        projectId,
        agentId,
        label: "One Shot",
        message: "once only",
        scheduleType: "once",
        scheduledAt: futureDate,
      });

      scheduler.scheduleTask(task);
      const job = [...mockJobs.values()][0];
      const callback = (job as unknown as Record<string, () => void>)._callback;
      callback();

      // Task should be disabled in DB
      const updated = schedulesService.getScheduledTask(dbTask.id);
      expect(updated!.scheduled_tasks.enabled).toBe(false);

      // Job should have been cancelled (cancelTask called for one-time tasks)
      expect(job.cancel).toHaveBeenCalled();
    });

    it("warns but does not throw when coordinator is missing", () => {
      const pm = makeMockProjectManager(new Map());
      const scheduler = new Scheduler(pm);
      const task = makeTask({ projectId: "nonexistent-proj" });

      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      scheduler.scheduleTask(task);
      const job = [...mockJobs.values()][0];
      const callback = (job as unknown as Record<string, () => void>)._callback;

      // Should not throw
      callback();

      expect(warnSpy).toHaveBeenCalled();
      const msg = warnSpy.mock.calls[0][0] as string;
      expect(msg).toContain("no coordinator");
      warnSpy.mockRestore();
    });

    it("warns but does not throw when agent is missing", () => {
      const coord = makeMockCoordinator(new Map()); // no agents
      const coordinators = new Map<string, Coordinator>();
      coordinators.set(projectId, coord);
      const pm = makeMockProjectManager(coordinators);

      const scheduler = new Scheduler(pm);
      const task = makeTask({ projectId, agentId: "nonexistent-agent" });

      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      scheduler.scheduleTask(task);
      const job = [...mockJobs.values()][0];
      const callback = (job as unknown as Record<string, () => void>)._callback;

      callback();

      expect(warnSpy).toHaveBeenCalled();
      const msg = warnSpy.mock.calls[0][0] as string;
      expect(msg).toContain("not found");
      warnSpy.mockRestore();
    });
  });
});
