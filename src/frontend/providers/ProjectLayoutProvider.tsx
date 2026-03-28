import { createContext, Suspense, useContext } from "react";
import { Outlet } from "react-router-dom";
import { Spinner } from "../components/ui/spinner";

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
      <Suspense
        fallback={
          <div className="flex items-center justify-center flex-1">
            <Spinner size="lg" className="text-muted-foreground" />
          </div>
        }
      >
        <Outlet />
      </Suspense>
    </ProjectLayoutContext.Provider>
  );
}
