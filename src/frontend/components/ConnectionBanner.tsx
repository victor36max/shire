import { useConnectionState } from "../lib/ws";

export default function ConnectionBanner() {
  const state = useConnectionState();

  if (state === "connected") return null;

  return (
    <div
      role="status"
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-destructive px-3 py-1.5 text-destructive-foreground text-sm"
    >
      <span className="inline-block h-2 w-2 rounded-full bg-destructive-foreground/60 animate-pulse" />
      {state === "connecting" ? "Reconnecting..." : "Connection lost — reconnecting..."}
    </div>
  );
}
