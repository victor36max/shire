import { useEffect, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { FileText, Settings, Clock, ArrowUpCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { CopyButton } from "./CopyButton";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import ProjectSwitcher from "./ProjectSwitcher";
import AgentListPanel from "./sidebar/AgentListPanel";
import SharedDrivePanel from "./sidebar/SharedDrivePanel";
import { useProjects, useVersionCheck } from "../hooks";

function VersionFooter() {
  const { data } = useVersionCheck();

  if (!data) return null;

  return (
    <div className="border-t border-border px-3 py-1.5 flex items-center justify-between">
      <span className="text-[10px] text-muted-foreground">v{data.current}</span>
      {data.updateAvailable && (
        <Popover>
          <PopoverTrigger className="inline-flex items-center gap-1 text-[10px] text-amber-500 hover:text-amber-400 transition-colors">
            <ArrowUpCircle className="h-3 w-3" />
            Update Available
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-auto p-3 text-xs space-y-2">
            <p className="font-medium">v{data.latest} available</p>
            {data.upgradeCommands.map((cmd, i) => (
              <div key={cmd} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-muted-foreground text-[10px]">or</span>}
                <code className="text-muted-foreground text-[10px]">{cmd}</code>
                <CopyButton text={cmd} />
              </div>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

interface AgentSidebarProps {
  onNewAgent: () => void;
  onBrowseCatalog: () => void;
}

export default function AgentSidebar({ onNewAgent, onBrowseCatalog }: AgentSidebarProps) {
  const navigate = useNavigate();
  const { projectName = "" } = useParams<{ projectName: string }>();
  const { data: projects = [] } = useProjects();
  const location = useLocation();

  const isSharedDrive = location.pathname === `/projects/${projectName}/shared`;
  const activeTab = isSharedDrive ? "shared-drive" : "agents";

  // Remember last path for each tab so switching back restores selection
  const projectRoot = `/projects/${projectName}`;
  const lastAgentPath = useRef(isSharedDrive ? projectRoot : location.pathname + location.search);
  const lastSharedPath = useRef(
    isSharedDrive ? location.pathname + location.search : `${projectRoot}/shared`,
  );

  useEffect(() => {
    if (!isSharedDrive) {
      lastAgentPath.current = location.pathname + location.search;
    } else {
      lastSharedPath.current = location.pathname + location.search;
    }
  }, [isSharedDrive, location.pathname, location.search]);

  // Reset remembered paths when switching projects (skip initial mount)
  const prevProjectRoot = useRef(projectRoot);
  useEffect(() => {
    if (prevProjectRoot.current !== projectRoot) {
      prevProjectRoot.current = projectRoot;
      lastAgentPath.current = projectRoot;
      lastSharedPath.current = `${projectRoot}/shared`;
    }
  }, [projectRoot]);

  const handleTabChange = (value: string) => {
    if (value === "shared-drive") {
      navigate(lastSharedPath.current);
    } else {
      navigate(lastAgentPath.current);
    }
  };

  return (
    <div className="border-r border-border bg-muted/30 flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <ProjectSwitcher projects={projects} currentProjectName={projectName} />
      </div>

      <div className="p-2 border-b border-border">
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="w-full">
            <TabsTrigger value="agents" className="flex-1">
              Agents
            </TabsTrigger>
            <TabsTrigger value="shared-drive" className="flex-1">
              Files
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {activeTab === "agents" ? (
        <AgentListPanel onNewAgent={onNewAgent} onBrowseCatalog={onBrowseCatalog} />
      ) : (
        <SharedDrivePanel />
      )}

      <div className="border-t border-border px-3 py-2 space-y-0.5">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => navigate(`/projects/${projectName}/details`)}
        >
          <FileText className="h-4 w-4" />
          Project Details
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => navigate(`/projects/${projectName}/schedules`)}
        >
          <Clock className="h-4 w-4" />
          Schedules
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => navigate(`/projects/${projectName}/settings`)}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Button>
      </div>

      <VersionFooter />
    </div>
  );
}
