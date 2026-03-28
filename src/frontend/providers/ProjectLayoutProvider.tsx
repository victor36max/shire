import { createContext, useContext } from "react";
import { Outlet } from "react-router-dom";

export interface ProjectLayoutContextValue {
  projectId: string | undefined;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  onNewAgent: () => void;
  onBrowseCatalog: () => void;
}

const ProjectLayoutContext = createContext<ProjectLayoutContextValue | null>(null);

export function useProjectLayout() {
  const ctx = useContext(ProjectLayoutContext);
  if (!ctx) {
    throw new Error("useProjectLayout must be used within a ProjectLayoutProvider");
  }
  return ctx;
}

interface ProjectLayoutProviderProps {
  value: ProjectLayoutContextValue;
}

export function ProjectLayoutProvider({ value }: ProjectLayoutProviderProps) {
  return (
    <ProjectLayoutContext.Provider value={value}>
      <Outlet />
    </ProjectLayoutContext.Provider>
  );
}
