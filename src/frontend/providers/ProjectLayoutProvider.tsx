import { createContext, Suspense, useContext, type ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { Spinner } from "../components/ui/spinner";

export interface ProjectLayoutContextValue {
  projectId: string | undefined;
  projectName: string;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  onNewAgent: () => void;
  onBrowseCatalog: () => void;
  panelFilePath: string | null;
  setPanelFilePath: (path: string | null) => void;
}

export const ProjectLayoutContext = createContext<ProjectLayoutContextValue | null>(null);

export function useProjectLayout() {
  const ctx = useContext(ProjectLayoutContext);
  if (!ctx) {
    throw new Error("useProjectLayout must be used within a ProjectLayoutProvider");
  }
  return ctx;
}

interface ProjectLayoutProviderProps {
  value: ProjectLayoutContextValue;
  children?: ReactNode;
}

export function ProjectLayoutProvider({ value, children }: ProjectLayoutProviderProps) {
  return (
    <ProjectLayoutContext.Provider value={value}>
      <Suspense
        fallback={
          <div className="flex items-center justify-center flex-1">
            <Spinner size="lg" className="text-muted-foreground" />
          </div>
        }
      >
        {children ?? <Outlet />}
      </Suspense>
    </ProjectLayoutContext.Provider>
  );
}
