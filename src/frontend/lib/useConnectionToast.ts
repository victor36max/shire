import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useConnectionState } from "./ws";

const TOAST_ID = "connection-status";

export function useConnectionToast(): void {
  const state = useConnectionState();
  const hasBeenConnected = useRef(false);
  const prevState = useRef(state);

  useEffect(() => {
    const prev = prevState.current;
    prevState.current = state;

    if (state === "connected") {
      if (!hasBeenConnected.current) {
        // First connection — stay silent
        hasBeenConnected.current = true;
        return;
      }
      if (prev !== "connected") {
        toast.success("Connected", { id: TOAST_ID, duration: 2000 });
      }
      return;
    }

    // Only show disconnect/reconnecting toasts after we've been connected once
    if (!hasBeenConnected.current) return;

    toast.loading("Reconnecting…", { id: TOAST_ID, duration: Infinity });
  }, [state]);
}
