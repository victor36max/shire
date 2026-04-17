import type { ProjectManager } from "./runtime/project-manager";
import type { Scheduler } from "./runtime/scheduler";

export type AppEnv = {
  Variables: {
    projectManager: ProjectManager;
    scheduler: Scheduler;
    username: string | null;
  };
};
