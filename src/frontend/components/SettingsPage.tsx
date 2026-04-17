import { useMemo } from "react";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { ChevronLeft } from "lucide-react";
import { PageLoader } from "./ui/spinner";
import AppLayout from "./AppLayout";
import ThemeSelector from "./ThemeSelector";
import { useNavigate } from "react-router-dom";
import ActivityLog from "./ActivityLog";
import AlertChannelTab from "./AlertChannelTab";
import { useProjectId, useActivity } from "../hooks";
import { useSubscription } from "../hooks/ws";
import { useQueryClient } from "@tanstack/react-query";
import type { InterAgentMessage } from "./types";

export default function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { projectId, projectName } = useProjectId();

  const {
    data: activityData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useActivity(projectId);

  useSubscription(projectId ? `project:${projectId}:schedules` : null, () => {
    queryClient.invalidateQueries({ queryKey: ["activity", projectId] });
  });

  const messages = useMemo<InterAgentMessage[]>(
    () => (activityData?.pages?.flatMap((page) => page.messages) ?? []) as InterAgentMessage[],
    [activityData],
  );
  const has_more_messages = hasNextPage ?? false;

  if (!projectId) {
    return <PageLoader />;
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back"
            onClick={() => navigate(`/projects/${projectName}`)}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>

        <Tabs defaultValue="activity">
          <TabsList>
            <TabsTrigger value="activity">Activity Log</TabsTrigger>
            <TabsTrigger value="alerts">Alerts</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
          </TabsList>

          <TabsContent value="activity" className="pt-4">
            <ActivityLog
              messages={messages}
              hasMore={has_more_messages}
              loadingMore={isFetchingNextPage}
              onLoadMore={fetchNextPage}
            />
          </TabsContent>

          <TabsContent value="alerts" className="pt-4">
            {projectId && <AlertChannelTab projectId={projectId} />}
          </TabsContent>

          <TabsContent value="appearance" className="space-y-4 pt-4">
            <ThemeSelector />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
