import { describe, it, expect } from "bun:test";
import { useTestDb } from "../test/setup";
import * as projects from "./projects";

describe("projects service", () => {
  useTestDb();

  describe("createProject", () => {
    it("creates a project with valid name", () => {
      const project = projects.createProject("my-project");
      expect(project.name).toBe("my-project");
      expect(project.id).toBeTruthy();
    });

    it("rejects duplicate names", () => {
      projects.createProject("unique-name");
      expect(() => projects.createProject("unique-name")).toThrow();
    });
  });

  describe("getProject", () => {
    it("returns project by id", () => {
      const project = projects.createProject("get-test");
      const found = projects.getProject(project.id);
      expect(found?.name).toBe("get-test");
    });

    it("returns undefined for missing id", () => {
      expect(projects.getProject("nonexistent-id")).toBeUndefined();
    });
  });

  describe("getProjectByName", () => {
    it("returns project by name", () => {
      projects.createProject("by-name-test");
      expect(projects.getProjectByName("by-name-test")?.name).toBe("by-name-test");
    });

    it("returns undefined for missing name", () => {
      expect(projects.getProjectByName("nonexistent")).toBeUndefined();
    });
  });

  describe("listProjects", () => {
    it("returns projects ordered by name", () => {
      projects.createProject("zeta");
      projects.createProject("alpha");
      projects.createProject("mid");

      const names = projects.listProjects().map((p) => p.name);
      expect(names).toEqual(["alpha", "mid", "zeta"]);
    });
  });

  describe("renameProject", () => {
    it("updates the project name", () => {
      const project = projects.createProject("old-name");
      const renamed = projects.renameProject(project.id, "new-name");
      expect(renamed?.name).toBe("new-name");
      expect(projects.getProject(project.id)?.name).toBe("new-name");
    });
  });

  describe("deleteProject", () => {
    it("deletes the project", () => {
      const project = projects.createProject("delete-me");
      projects.deleteProject(project.id);
      expect(projects.getProject(project.id)).toBeUndefined();
    });
  });
});
