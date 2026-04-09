import * as React from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Spinner } from "./ui/spinner";
import AgentSidebar from "./AgentSidebar";
import AgentForm, { type AgentFormPayload } from "./AgentForm";
import CatalogBrowser from "./CatalogBrowser";
import { type Agent } from "./types";
import {
  useResolveProjectId,
  useAgents,
  useCreateAgent,
  useUpdateAgent,
  useUpdateAgentCache,
  fetchCatalogAgent,
  findDefaultAgent,
} from "../hooks";
import { useSubscription, type AgentListWsEvent } from "../lib/ws";
import {
  ProjectLayoutProvider,
  type ProjectLayoutContextValue,
} from "../providers/ProjectLayoutProvider";

const SIDEBAR_MIN = 224;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 280;
const STORAGE_KEY = "shire-sidebar-width";

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = React.useState(
    typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : true,
  );

  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isDesktop;
}

function useSidebarWidth() {
  const [width, setWidth] = React.useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const n = Number(stored);
        if (n >= SIDEBAR_MIN && n <= SIDEBAR_MAX) return n;
      }
    } catch {
      // ignore
    }
    return SIDEBAR_DEFAULT;
  });

  const persist = React.useCallback((w: number) => {
    setWidth(w);
    try {
      localStorage.setItem(STORAGE_KEY, String(w));
    } catch {
      // ignore
    }
  }, []);

  return [width, persist] as const;
}

function ResizeHandle({ onDrag }: { onDrag: (width: number) => void }) {
  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = (e.currentTarget as HTMLElement).previousElementSibling?.clientWidth ?? 0;

      const onMove = (ev: PointerEvent) => {
        onDrag(startWidth + (ev.clientX - startX));
      };

      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [onDrag],
  );

  return (
    <div
      className="w-px bg-border hover:bg-ring active:bg-ring cursor-col-resize shrink-0 after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-[''] relative"
      onPointerDown={handlePointerDown}
    />
  );
}

export default function ProjectLayout() {
  const { projectName, agentName } = useParams();
  const queryClient = useQueryClient();
  const projectId = useResolveProjectId(projectName);
  const updateAgentCache = useUpdateAgentCache(projectId);
  const isDesktop = useIsDesktop();
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth();

  const { data: agentList = [] } = useAgents(projectId);
  const selectedAgent = agentName
    ? agentList.find((a) => a.name === agentName)
    : (findDefaultAgent(agentList) ?? agentList[0]);
  const selectedAgentId = selectedAgent?.id;

  const createAgent = useCreateAgent(projectId ?? "");
  const updateAgent = useUpdateAgent(projectId ?? "");

  // --- Modal state ---
  const [formOpen, setFormOpen] = React.useState(false);
  const [formTitle, setFormTitle] = React.useState("New Agent");
  const [editingAgent, setEditingAgent] = React.useState<Agent | null>(null);
  const [currentAgent, setCurrentAgent] = React.useState<Agent | null>(null);
  const [catalogOpen, setCatalogOpen] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  // Close mobile sidebar when agent changes
  const [prevSelectedAgentId, setPrevSelectedAgentId] = React.useState(selectedAgentId);
  if (selectedAgentId !== prevSelectedAgentId) {
    setPrevSelectedAgentId(selectedAgentId);
    setSidebarOpen(false);
  }

  const handleCatalogAdd = async (name: string) => {
    setCatalogOpen(false);
    try {
      const agent = await fetchCatalogAgent(name);
      setCurrentAgent({
        id: "",
        name: agent.name,
        description: agent.description,
        harness: agent.harness,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        skills: [],
        status: "idle",
        busy: false,
        unreadCount: 0,
        lastUserMessageAt: null,
      });
      setEditingAgent(null);
      setFormTitle("New Agent from Catalog");
      setFormOpen(true);
    } catch {
      setCatalogOpen(true);
    }
  };

  // Subscribe to project-level agent list updates
  useSubscription<AgentListWsEvent>(projectId ? `project:${projectId}:agents` : null, (event) => {
    switch (event.type) {
      case "agent_busy":
        updateAgentCache(event.payload.agentId, {
          busy: event.payload.active,
        });
        break;
      case "agent_status":
        updateAgentCache(event.payload.agentId, {
          status: event.payload.status,
        });
        break;
      case "new_message_notification":
        if (event.payload.agentId === selectedAgentId) {
          queryClient.invalidateQueries({
            queryKey: ["messages", projectId, selectedAgentId],
          });
        }
        queryClient.invalidateQueries({ queryKey: ["agents", projectId] });
        break;
      case "agent_created":
      case "agent_deleted":
        queryClient.invalidateQueries({ queryKey: ["agents", projectId] });
        break;
    }
  });

  const handleBrowseCatalog = () => {
    setCatalogOpen(true);
  };

  const handleNew = () => {
    setCurrentAgent(null);
    setEditingAgent(null);
    setFormTitle("New Agent");
    setFormOpen(true);
  };

  const handleFormSave = (_event: string, payload: AgentFormPayload) => {
    setFormOpen(false);
    if (editingAgent) {
      const { id: _id, ...fields } = payload;
      updateAgent.mutate({ id: editingAgent.id, ...fields });
    } else {
      createAgent.mutate(payload);
    }
  };

  const handleDrag = React.useCallback(
    (w: number) => {
      setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));
    },
    [setSidebarWidth],
  );

  const contextValue: ProjectLayoutContextValue = {
    projectId,
    sidebarOpen,
    setSidebarOpen,
    onNewAgent: handleNew,
    onBrowseCatalog: handleBrowseCatalog,
  };

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-dvh">
        <Spinner size="lg" className="text-muted-foreground" />
      </div>
    );
  }

  const sidebar = <AgentSidebar onNewAgent={handleNew} onBrowseCatalog={handleBrowseCatalog} />;
  const content = (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto">
      <ProjectLayoutProvider value={contextValue} />
    </div>
  );

  return (
    <div className="flex h-dvh bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      {!isDesktop && (
        <>
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-40"
              aria-hidden="true"
              onClick={() => setSidebarOpen(false)}
            >
              <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
            </div>
          )}
          <div
            className={`fixed top-[env(safe-area-inset-top)] bottom-[env(safe-area-inset-bottom)] left-[env(safe-area-inset-left)] z-50 w-64 transition-transform duration-200 ${
              sidebarOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            {sidebar}
          </div>
          {content}
        </>
      )}

      {isDesktop && (
        <>
          <div className="h-full shrink-0" style={{ width: sidebarWidth }}>
            {sidebar}
          </div>
          <ResizeHandle onDrag={handleDrag} />
          {content}
        </>
      )}

      <AgentForm
        key={currentAgent?.id ?? "new"}
        open={formOpen}
        title={formTitle}
        agent={currentAgent}
        onSave={handleFormSave}
        onClose={() => setFormOpen(false)}
      />

      <CatalogBrowser
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        onAdd={handleCatalogAdd}
      />
    </div>
  );
}
