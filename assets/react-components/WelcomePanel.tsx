import { Menu } from "lucide-react";
import { Button } from "./components/ui/button";

interface WelcomePanelProps {
  onNewAgent: () => void;
  onMenuToggle?: () => void;
}

export default function WelcomePanel({ onNewAgent, onMenuToggle }: WelcomePanelProps) {
  return (
    <div className="flex flex-col h-full">
      {onMenuToggle && (
        <div className="px-4 py-3 border-b border-border md:hidden">
          <Button variant="ghost" size="icon" aria-label="Open menu" onClick={onMenuToggle}>
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      )}
      <div className="flex flex-col items-center justify-center flex-1 text-center p-8">
        <h2 className="text-2xl font-bold mb-2">Shire</h2>
        <p className="text-muted-foreground mb-6">Select an agent from the sidebar to start chatting.</p>
        <Button onClick={onNewAgent}>+ New Agent</Button>
      </div>
    </div>
  );
}
