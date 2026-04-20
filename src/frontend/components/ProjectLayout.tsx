import * as React from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { type PanelImperativeHandle, useDefaultLayout } from "react-resizable-panels";
import { Spinner } from "./ui/spinner";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "./ui/resizable";
import AgentSidebar from "./AgentSidebar";
import AgentForm, { type AgentFormPayload } from "./AgentForm";
import CatalogBrowser from "./CatalogBrowser";
import FilePreviewPanel from "./FilePreviewPanel";
import { type Agent } from "./types";
import {
  useResolveProjectId,
  useAgents,
  useCreateAgent,
  useUpdateAgent,
  useUpdateAgentCache,
  fetchCatalogAgent,
  findDefaultAgent,
  useIsDesktop,
  useSyncedParam,
} from "../hooks";
import { useSubscription } from "../hooks/ws";
import type { AgentListWsEvent, SharedDriveWsEvent } from "../lib/ws";
import {
  ProjectLayoutContext,
  ProjectLayoutProvider,
  type ProjectLayoutContextValue,
} from "../providers/ProjectLayoutProvider";

const ProjectLayoutContextProvider = ProjectLayoutContext.Provider;

export default function ProjectLayout() {
  const { projectName, agentName } = useParams();
  const queryClient = useQueryClient();
  const projectId = useResolveProjectId(projectName);
  const updateAgentCache = useUpdateAgentCache(projectId);
  const isDesktop = useIsDesktop();

  const { data: agentList = [] } = useAgents(projectId);
  const selectedAgent = agentName
    ? agentList.find((a) => a.name === agentName)
    : (findDefaultAgent(agentList) ?? agentList[0]);
  const selectedAgentId = selectedAgent?.id;

  const createAgent = useCreateAgent(projectId ?? "");
  const updateAgent = useUpdateAgent(projectId ?? "");

  const navigate = useNavigate();
  const location = useLocation();
  const isSharedDriveRoute = location.pathname === `/projects/${projectName}/shared`;

  // --- File preview panel state (synced to URL ?preview= and localStorage) ---
  const [panelFilePath, setPanelFilePath] = useSyncedParam(
    "preview",
    `shire:preview:${projectName}`,
    { disabled: isSharedDriveRoute },
  );
  const filePanelRef = React.useRef<PanelImperativeHandle>(null);

  // Only show the panel on agent chat routes, not on the shared drive view
  const effectivePanelFilePath = isSharedDriveRoute ? null : panelFilePath;

  // --- Remember last-viewed agent per project ---
  const agentStorageKey = `shire:agent:${projectName}`;
  React.useEffect(() => {
    if (agentName) {
      try {
        localStorage.setItem(agentStorageKey, agentName);
      } catch {
        // ignore
      }
    }
  }, [agentName, agentStorageKey]);

  // Redirect project index to last-viewed agent (only on the exact index route)
  const isProjectIndex = location.pathname === `/projects/${projectName}`;
  React.useEffect(() => {
    if (!isProjectIndex || agentList.length === 0) return;
    try {
      const saved = localStorage.getItem(agentStorageKey);
      if (saved && agentList.some((a) => a.name === saved)) {
        navigate(`/projects/${projectName}/agents/${saved}`, { replace: true });
      }
    } catch {
      // ignore
    }
  }, [isProjectIndex, agentList, agentStorageKey, projectName, navigate]);

  // Persist sidebar/panel sizes to localStorage (global, not per-project).
  // Always include all three panels so the sidebar size is saved under one
  // consistent key regardless of whether the file panel is open or collapsed.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "shire:layout",
    panelIds: ["sidebar", "content", "file-panel"],
  });

  // Track last known panel size so onResize can distinguish "user collapsed"
  // from "initial layout at size 0" (which fires via ResizeObserver before
  // React effects run, so we can't use a ref set in useEffect).
  const [lastPanelSize, setLastPanelSize] = React.useState(effectivePanelFilePath ? 33 : 0);

  // Expand/collapse the file panel imperatively.
  // Use resize() instead of expand() so the panel opens to ~33%, not just minSize.
  // If the library has a saved layout, expand() restores that; otherwise we set 33%.
  React.useEffect(() => {
    if (effectivePanelFilePath) {
      const panel = filePanelRef.current;
      if (panel) {
        panel.expand();
        // expand() only goes to minSize on first open; resize to 33% if still small
        requestAnimationFrame(() => {
          if (panel.getSize().asPercentage < 25) {
            panel.resize("33");
          }
        });
      }
    } else {
      filePanelRef.current?.collapse();
    }
  }, [effectivePanelFilePath]);

  // --- Modal state ---
  const [formOpen, setFormOpen] = React.useState(false);
  const [formTitle, setFormTitle] = React.useState("New Agent");
  const [editingAgent, setEditingAgent] = React.useState<Agent | null>(null);
  const [currentAgent, setCurrentAgent] = React.useState<Agent | null>(null);
  const [catalogOpen, setCatalogOpen] = React.useState(false);
  const [formKey, setFormKey] = React.useState(0);
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
        emoji: agent.emoji,
        description: agent.description,
        harness: agent.harness,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        skills: [],
        busy: false,
        unreadCount: 0,
        lastUserMessageAt: null,
      });
      setEditingAgent(null);
      setFormTitle("New Agent from Catalog");
      setFormKey((k) => k + 1);
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

  // Subscribe to shared drive file changes to keep caches fresh
  useSubscription<SharedDriveWsEvent>(
    projectId ? `project:${projectId}:shared-drive` : null,
    React.useCallback(
      (event) => {
        if (event.type === "file_changed") {
          queryClient.invalidateQueries({ queryKey: ["shared-drive", projectId] });
          queryClient.invalidateQueries({ queryKey: ["file-content", projectId] });
        }
      },
      [queryClient, projectId],
    ),
  );

  const handleBrowseCatalog = () => {
    setCatalogOpen(true);
  };

  const handleNew = () => {
    setCurrentAgent(null);
    setEditingAgent(null);
    setFormTitle("New Agent");
    setFormKey((k) => k + 1);
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

  const contextValue: ProjectLayoutContextValue = {
    projectId,
    projectName: projectName ?? "",
    sidebarOpen,
    setSidebarOpen,
    onNewAgent: handleNew,
    onBrowseCatalog: handleBrowseCatalog,
    panelFilePath,
    setPanelFilePath,
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
    <ProjectLayoutContextProvider value={contextValue}>
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
          <ResizablePanelGroup
            orientation="horizontal"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
          >
            <ResizablePanel id="sidebar" defaultSize="20" minSize="15" maxSize="35">
              {sidebar}
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel
              id="content"
              defaultSize={effectivePanelFilePath ? "47" : "80"}
              minSize="30"
            >
              {content}
            </ResizablePanel>
            <ResizableHandle className={effectivePanelFilePath ? "" : "hidden"} />
            <ResizablePanel
              id="file-panel"
              panelRef={filePanelRef}
              defaultSize={effectivePanelFilePath ? "33" : "0"}
              minSize="20"
              maxSize="50"
              collapsible
              collapsedSize={0}
              onResize={(size) => {
                const prev = lastPanelSize;
                setLastPanelSize(size.asPercentage);
                // Only clear when the panel transitions from expanded → collapsed
                // (not on the initial layout where it starts at 0).
                if (size.asPercentage === 0 && prev > 0 && effectivePanelFilePath) {
                  setPanelFilePath(null);
                }
              }}
            >
              {effectivePanelFilePath && projectId && (
                <FilePreviewPanel
                  projectId={projectId}
                  projectName={projectName ?? ""}
                  filePath={effectivePanelFilePath}
                  onClose={() => setPanelFilePath(null)}
                  onExpand={() => {
                    navigate(
                      `/projects/${projectName}/shared?file=${encodeURIComponent(effectivePanelFilePath)}`,
                    );
                    setPanelFilePath(null);
                  }}
                />
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}

        <AgentForm
          key={currentAgent?.id || formKey}
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
    </ProjectLayoutContextProvider>
  );
}
