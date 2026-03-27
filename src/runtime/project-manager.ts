import { rmSync } from "fs";
import { bus } from "../events";
import { Coordinator } from "./coordinator";
import * as projectsService from "../services/projects";
import * as workspace from "../services/workspace";

export class ProjectManager {
  private coordinators = new Map<string, Coordinator>();

  async boot(): Promise<void> {
    const projects = projectsService.listProjects();
    for (const project of projects) {
      await this.bootProject(project.id);
    }
    console.log(`ProjectManager: booted ${projects.length} project(s)`);
  }

  async createProject(
    name: string,
  ): Promise<
    | { ok: true; project: ReturnType<typeof projectsService.createProject> }
    | { ok: false; error: string }
  > {
    try {
      const project = projectsService.createProject(name);
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
      coordinator.stopAll();
      this.coordinators.delete(id);
    }

    // Remove workspace
    try {
      rmSync(workspace.root(id), { recursive: true, force: true });
    } catch {
      // ok
    }

    projectsService.deleteProject(id);

    bus.emit("projects:lobby", {
      type: "project_destroyed",
      payload: { id },
    });

    return { ok: true };
  }

  async restartProject(id: string): Promise<boolean> {
    const coordinator = this.coordinators.get(id);
    if (coordinator) {
      coordinator.stopAll();
      this.coordinators.delete(id);
    }

    await this.bootProject(id);

    bus.emit("projects:lobby", {
      type: "project_restarted",
      payload: { id },
    });

    return true;
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

  listProjects(): Array<{
    id: string;
    name: string;
    status: "running" | "stopped";
  }> {
    const projects = projectsService.listProjects();
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: this.coordinators.has(p.id) ? ("running" as const) : ("stopped" as const),
    }));
  }

  // --- Private ---

  private async bootProject(projectId: string): Promise<void> {
    const coordinator = new Coordinator(projectId);
    this.coordinators.set(projectId, coordinator);
    await coordinator.deployAndScan();
  }
}
