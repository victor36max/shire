import { Button } from "./components/ui/button";

interface WelcomePanelProps {
  onNewAgent: () => void;
}

export default function WelcomePanel({ onNewAgent }: WelcomePanelProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <h2 className="text-2xl font-bold mb-2">Shire</h2>
      <p className="text-muted-foreground mb-6">Select an agent from the sidebar to start chatting.</p>
      <Button onClick={onNewAgent}>+ New Agent</Button>
    </div>
  );
}
