import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { createTestDb } from "../test/setup";
import { ProjectManager } from "./project-manager";
import * as projectsService from "../services/projects";
import { bus } from "../events";
import { rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let testDir: string;
let pm: ProjectManager;

beforeEach(() => {
  createTestDb();
  testDir = join(tmpdir(), `pm_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  process.env.SHIRE_PROJECTS_DIR = testDir;

  mock.module("./harness", () => ({
    createHarness: () => ({
      start: async () => {},
      sendMessage: async () => {},
      interrupt: async () => {},
      clearSession: async () => {},
      stop: async () => {},
      onEvent: () => {},
      isProcessing: () => false,
      getSessionId: () => null,
    }),
  }));

  pm = new ProjectManager();
});

afterEach(async () => {
  // Stop all coordinators
  const projects = pm.listProjects();
  for (const p of projects) {
    const coord = pm.getCoordinator(p.id);
    if (coord) await coord.stopAll();
  }
  rmSync(testDir, { recursive: true, force: true });
});

describe("ProjectManager", () => {
  describe("boot", () => {
    it("boots all existing projects", async () => {
      projectsService.createProject("project-a");
      projectsService.createProject("project-b");

      await pm.boot();

      const list = pm.listProjects();
      expect(list.length).toBe(2);
      for (const p of list) {
        expect(p.name).toBeTruthy();
      }
    });

    it("boots successfully with no projects", async () => {
      await pm.boot();
      expect(pm.listProjects()).toEqual([]);
    });
  });

  describe("createProject", () => {
    it("creates and boots a project", async () => {
      const result = await pm.createProject("new-project");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const list = pm.listProjects();
      expect(list.length).toBe(1);
      expect(list[0].name).toBe("new-project");
    });

    it("emits project_created event", async () => {
      const events: Array<{ type: string }> = [];
      const unsub = bus.on("projects:lobby", (e) => events.push(e));

      await pm.createProject("event-proj");
      unsub();

      expect(events.some((e) => e.type === "project_created")).toBe(true);
    });

    it("returns error for duplicate names", async () => {
      await pm.createProject("dup");
      const result = await pm.createProject("dup");
      expect(result.ok).toBe(false);
    });
  });

  describe("destroyProject", () => {
    it("destroys a project and emits event", async () => {
      const createResult = await pm.createProject("destroy-me");
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const events: Array<{ type: string }> = [];
      const unsub = bus.on("projects:lobby", (e) => events.push(e));

      const result = await pm.destroyProject(createResult.project.id);
      unsub();

      expect(result.ok).toBe(true);
      expect(pm.listProjects().length).toBe(0);
      expect(events.some((e) => e.type === "project_destroyed")).toBe(true);
    });
  });

  describe("renameProject", () => {
    it("renames an existing project and emits event", async () => {
      const createResult = await pm.createProject("rename-me");
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const events: Array<{ type: string }> = [];
      const unsub = bus.on("projects:lobby", (e) => events.push(e));

      const result = pm.renameProject(createResult.project.id, "renamed");
      unsub();

      expect(result).toBeDefined();
      expect(result?.name).toBe("renamed");
      expect(events.some((e) => e.type === "project_renamed")).toBe(true);
    });
  });

  describe("getCoordinator", () => {
    it("returns undefined for nonexistent project", () => {
      expect(pm.getCoordinator("nonexistent")).toBeUndefined();
    });

    it("returns coordinator for booted project", async () => {
      const createResult = await pm.createProject("has-coord");
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      expect(pm.getCoordinator(createResult.project.id)).toBeDefined();
    });
  });

  describe("listProjects", () => {
    it("lists unbooted projects", () => {
      projectsService.createProject("unbooted");
      const list = pm.listProjects();
      expect(list.length).toBe(1);
      expect(list[0].name).toBe("unbooted");
    });
  });
});
