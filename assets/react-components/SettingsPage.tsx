import * as React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Button } from "./components/ui/button";
import { ChevronLeft } from "lucide-react";
import AppLayout from "./components/AppLayout";
import SecretList from "./SecretList";
import ActivityLog from "./ActivityLog";
import type { Secret, InterAgentMessage } from "./types";

interface SettingsPageProps {
  secrets: Secret[];
  messages: InterAgentMessage[];
  has_more_messages: boolean;
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}

export default function SettingsPage({ secrets, messages, has_more_messages, pushEvent }: SettingsPageProps) {
  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Back" onClick={() => window.location.assign("/")}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>

        <Tabs defaultValue="secrets">
          <TabsList>
            <TabsTrigger value="secrets">Global Secrets</TabsTrigger>
            <TabsTrigger value="activity">Activity Log</TabsTrigger>
          </TabsList>
          <TabsContent value="secrets">
            <SecretList secrets={secrets} pushEvent={pushEvent} />
          </TabsContent>
          <TabsContent value="activity">
            <ActivityLog messages={messages} hasMore={has_more_messages} pushEvent={pushEvent} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
