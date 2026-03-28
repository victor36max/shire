import { useMemo } from "react";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { ChevronLeft, Loader2 } from "lucide-react";
import AppLayout from "./AppLayout";
import ThemeSelector from "./ThemeSelector";
import { navigate } from "../lib/navigate";
import ActivityLog from "./ActivityLog";
import { useProjectId, useActivity } from "../lib/hooks";
import { useSubscription } from "../lib/ws";
import { useQueryClient } from "@tanstack/react-query";
import type { InterAgentMessage } from "./types";

export default function SettingsPage() {
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
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
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

          <TabsContent value="appearance" className="space-y-4 pt-4">
            <ThemeSelector />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
