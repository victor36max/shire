import { bus } from "../events";
import { getDb } from "../db";
import { Coordinator } from "./coordinator";
import * as projectsService from "../services/projects";
import * as workspace from "../services/workspace";

export class ProjectManager {
  private coordinators = new Map<string, Coordinator>();

  async boot(): Promise<void> {
    const projects = projectsService.listProjects();
    const results = await Promise.allSettled(
      projects.map((project) => this.bootProject(project.id)),
    );
    const ok = results.filter((r) => r.status === "fulfilled" && r.value === true).length;
    console.log(`ProjectManager: booted ${ok}/${projects.length} project(s)`);
  }

  async createProject(
    name: string,
  ): Promise<
    | { ok: true; project: ReturnType<typeof projectsService.createProject> }
    | { ok: false; error: string }
  > {
    try {
      // Create DB record + workspace dirs atomically
      const project = getDb().transaction((tx) => {
        const p = projectsService.createProject(name, tx);
        workspace.ensureProjectDirsSync(p.id);
        return p;
      });
      await this.bootProject(project.id);

      bus.emit("projects:lobby", {
        type: "project_created",
        payload: { id: project.id, name: project.name },
      });

      return { ok: true, project };
    } catch (err) {
      return { ok: false, error: `Failed to create project: ${err}` };
    }
  }

  async destroyProject(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const coordinator = this.coordinators.get(id);
    if (coordinator) {
      await coordinator.stopAll();
      this.coordinators.delete(id);
    }
    // Delete DB record + workspace atomically
    getDb().transaction((tx) => {
      projectsService.deleteProject(id, tx);
      workspace.removeProjectDirSync(id);
    });

    bus.emit("projects:lobby", {
      type: "project_destroyed",
      payload: { id },
    });

    return { ok: true };
  }

  renameProject(id: string, name: string): ReturnType<typeof projectsService.renameProject> {
    const result = projectsService.renameProject(id, name);

    bus.emit("projects:lobby", {
      type: "project_renamed",
      payload: { id, name },
    });

    return result;
  }

  getCoordinator(projectId: string): Coordinator | undefined {
    return this.coordinators.get(projectId);
  }

  listProjects(): Array<{ id: string; name: string }> {
    return projectsService.listProjects().map((p) => ({ id: p.id, name: p.name }));
  }

  // --- Private ---

  private async bootProject(projectId: string): Promise<boolean> {
    try {
      const coordinator = new Coordinator(projectId);
      this.coordinators.set(projectId, coordinator);
      await coordinator.deployAndScan();
      return true;
    } catch (err) {
      console.error(`ProjectManager: failed to boot project ${projectId}:`, err);
      return false;
    }
  }
}
