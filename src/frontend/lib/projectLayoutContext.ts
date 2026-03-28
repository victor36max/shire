import { useOutletContext } from "react-router-dom";

export interface ProjectLayoutContext {
  projectId: string | undefined;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  onNewAgent: () => void;
  onBrowseCatalog: () => void;
}

export function useProjectLayout() {
  return useOutletContext<ProjectLayoutContext>();
}
