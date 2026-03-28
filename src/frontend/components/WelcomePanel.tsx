import { Menu, MessageSquare, Users, Zap } from "lucide-react";
import { Button } from "./ui/button";

interface WelcomePanelProps {
  onNewAgent: () => void;
  onBrowseCatalog?: () => void;
  onMenuToggle?: () => void;
  hasAgents?: boolean;
}

export default function WelcomePanel({
  onNewAgent,
  onBrowseCatalog,
  onMenuToggle,
  hasAgents,
}: WelcomePanelProps) {
  return (
    <div className="flex flex-col h-full">
      {onMenuToggle && (
        <div className="px-4 py-3 border-b border-border md:hidden">
          <Button variant="ghost" size="icon" aria-label="Open menu" onClick={onMenuToggle}>
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      )}
      <div className="flex flex-col items-center justify-center flex-1 p-8 max-w-lg mx-auto">
        <h1 className="text-2xl font-bold mb-2">Shire</h1>

        {hasAgents ? (
          <>
            <p className="text-muted-foreground text-center mb-6">
              Select an agent from the sidebar to start chatting.
            </p>
            <Button onClick={onNewAgent}>+ New Agent</Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-center mb-8">
              Create AI agents that work together. Each agent runs in its own sandbox and can
              collaborate with others through messaging.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full mb-8">
              <div className="flex flex-col items-center text-center gap-2 p-3">
                <div className="rounded-full bg-primary/10 p-2.5">
                  <MessageSquare className="h-5 w-5 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">Chat with agents directly</p>
              </div>
              <div className="flex flex-col items-center text-center gap-2 p-3">
                <div className="rounded-full bg-primary/10 p-2.5">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">Agents collaborate autonomously</p>
              </div>
              <div className="flex flex-col items-center text-center gap-2 p-3">
                <div className="rounded-full bg-primary/10 p-2.5">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">Isolated VMs per project</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              {onBrowseCatalog && (
                <Button variant="outline" onClick={onBrowseCatalog}>
                  Browse Catalog
                </Button>
              )}
              <Button onClick={onNewAgent}>+ New Agent</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
