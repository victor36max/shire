import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test";
import { createTestDb } from "../test/setup";
import * as projectsService from "../services/projects";
import * as schedulesService from "../services/schedules";
import * as agentsService from "../services/agents";
import { bus } from "../events";

// Mock node-schedule
const mockCancel = mock(() => true);
const mockScheduleJob = mock((_rule: unknown, _cb: () => void) => ({ cancel: mockCancel }));
mock.module("node-schedule", () => ({
  default: { scheduleJob: mockScheduleJob },
  scheduleJob: mockScheduleJob,
}));

// Import Scheduler after mocking
const { Scheduler } = await import("./scheduler");

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    projectId: "proj-1",
    agentId: "agent-1",
    label: "Daily report",
    message: "Generate report",
    scheduleType: "recurring" as const,
    cronExpression: "0 9 * * *" as string | null,
    scheduledAt: null as string | null,
    enabled: true,
    ...overrides,
  };
}

describe("Scheduler", () => {
  beforeEach(() => {
    createTestDb();
    mockScheduleJob.mockClear();
    mockCancel.mockClear();
  });

  describe("boot", () => {
    it("loads enabled tasks from DB", () => {
      const proj = projectsService.createProject("sched-proj");
      const agent = agentsService.createAgent(proj.id, {
        name: "bot",
        harness: "claude_code",
      });
      schedulesService.createScheduledTask({
        projectId: proj.id,
        agentId: agent.id,
        label: "task-1",
        message: "hello",
        scheduleType: "recurring",
        cronExpression: "0 9 * * *",
        scheduledAt: null,
        enabled: true,
      });
      schedulesService.createScheduledTask({
        projectId: proj.id,
        agentId: agent.id,
        label: "task-disabled",
        message: "nope",
        scheduleType: "recurring",
        cronExpression: "0 10 * * *",
        scheduledAt: null,
        enabled: false,
      });

      const pm = { getCoordinator: mock(() => null) };
      const scheduler = new Scheduler(pm as never);
      scheduler.boot();

      // Only the enabled task should trigger scheduleJob
      expect(mockScheduleJob).toHaveBeenCalledTimes(1);
    });

    it("handles zero enabled tasks", () => {
      const pm = { getCoordinator: mock(() => null) };
      const scheduler = new Scheduler(pm as never);
      scheduler.boot();
      expect(mockScheduleJob).not.toHaveBeenCalled();
    });
  });

  describe("scheduleTask", () => {
    it("registers a recurring task with cron expression", () => {
      const pm = { getCoordinator: mock(() => null) };
      const scheduler = new Scheduler(pm as never);
      const task = makeTask({ id: "t1" });
      scheduler.scheduleTask(task);
      expect(mockScheduleJob).toHaveBeenCalledTimes(1);
      expect(mockScheduleJob.mock.calls[0][0]).toEqual({ rule: "0 9 * * *", tz: "Etc/UTC" });
    });

    it("skips disabled tasks", () => {
      const pm = { getCoordinator: mock(() => null) };
      const scheduler = new Scheduler(pm as never);
      scheduler.scheduleTask(makeTask({ id: "t2", enabled: false }));
      expect(mockScheduleJob).not.toHaveBeenCalled();
    });

    it("cancels existing job before rescheduling", () => {
      const pm = { getCoordinator: mock(() => null) };
      const scheduler = new Scheduler(pm as never);
      scheduler.scheduleTask(makeTask({ id: "t3" }));
      scheduler.scheduleTask(makeTask({ id: "t3" }));
      expect(mockCancel).toHaveBeenCalledTimes(1);
      expect(mockScheduleJob).toHaveBeenCalledTimes(2);
    });

    it("registers a one-time task with future date", () => {
      const pm = { getCoordinator: mock(() => null) };
      const scheduler = new Scheduler(pm as never);
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      scheduler.scheduleTask(
        makeTask({
          id: "t4",
          scheduleType: "once",
          cronExpression: null,
          scheduledAt: futureDate,
        }),
      );
      expect(mockScheduleJob).toHaveBeenCalledTimes(1);
    });

    it("skips one-time task with past date", () => {
      const pm = { getCoordinator: mock(() => null) };
      const scheduler = new Scheduler(pm as never);
      scheduler.scheduleTask(
        makeTask({
          id: "t5",
          scheduleType: "once",
          cronExpression: null,
          scheduledAt: "2020-01-01T00:00:00Z",
        }),
      );
      expect(mockScheduleJob).not.toHaveBeenCalled();
    });
  });

  describe("cancelTask", () => {
    it("cancels and removes a scheduled job", () => {
      const pm = { getCoordinator: mock(() => null) };
      const scheduler = new Scheduler(pm as never);
      scheduler.scheduleTask(makeTask({ id: "t6" }));
      scheduler.cancelTask("t6");
      expect(mockCancel).toHaveBeenCalledTimes(1);
    });

    it("no-ops for unknown task", () => {
      const pm = { getCoordinator: mock(() => null) };
      const scheduler = new Scheduler(pm as never);
      scheduler.cancelTask("unknown");
      expect(mockCancel).not.toHaveBeenCalled();
    });
  });

  describe("cancelAll", () => {
    it("cancels all jobs", () => {
      const pm = { getCoordinator: mock(() => null) };
      const scheduler = new Scheduler(pm as never);
      scheduler.scheduleTask(makeTask({ id: "a" }));
      scheduler.scheduleTask(makeTask({ id: "b" }));
      scheduler.cancelAll();
      expect(mockCancel).toHaveBeenCalledTimes(2);
    });
  });

  describe("fireTask", () => {
    it("warns when coordinator is missing", () => {
      const pm = { getCoordinator: mock(() => null) };
      const scheduler = new Scheduler(pm as never);
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      // Access private fireTask via scheduling and triggering the callback
      const task = makeTask({ id: "fire-1" });
      let capturedCallback: (() => void) | undefined;
      mockScheduleJob.mockImplementationOnce((_rule: unknown, cb: () => void) => {
        capturedCallback = cb;
        return { cancel: mockCancel };
      });
      scheduler.scheduleTask(task);
      capturedCallback!();

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("sends message to agent and emits event", () => {
      const proj = projectsService.createProject("fire-proj");
      const agent = agentsService.createAgent(proj.id, {
        name: "fire-bot",
        harness: "claude_code",
      });

      const mockSendMessage = mock(() => Promise.resolve({ ok: true }));
      const mockGetAgent = mock(() => ({ sendMessage: mockSendMessage }));
      const mockCoordinator = { getAgent: mockGetAgent };
      const pm = { getCoordinator: mock(() => mockCoordinator) };
      const scheduler = new Scheduler(pm as never);

      const task = makeTask({
        id: schedulesService.createScheduledTask({
          projectId: proj.id,
          agentId: agent.id,
          label: "fire-label",
          message: "fire-msg",
          scheduleType: "recurring",
          cronExpression: "0 9 * * *",
          scheduledAt: null,
          enabled: true,
        }).id,
        projectId: proj.id,
        agentId: agent.id,
        label: "fire-label",
        message: "fire-msg",
      });

      const events: Array<{ type: string }> = [];
      const unsub = bus.on(`project:${proj.id}:schedules`, (e) => events.push(e));

      let capturedCallback: (() => void) | undefined;
      mockScheduleJob.mockImplementationOnce((_rule: unknown, cb: () => void) => {
        capturedCallback = cb;
        return { cancel: mockCancel };
      });
      scheduler.scheduleTask(task);
      capturedCallback!();

      expect(mockSendMessage).toHaveBeenCalledWith("[Scheduled: fire-label] fire-msg", "system");
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("schedule_fired");

      unsub();
    });
  });
});
