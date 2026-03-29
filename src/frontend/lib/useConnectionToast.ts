import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useConnectionState } from "./ws";

const TOAST_ID = "connection-status";
const GRACE_PERIOD_MS = 10_000;

export function useConnectionToast(): void {
  const state = useConnectionState();
  const hasBeenConnected = useRef(false);
  const prevState = useRef(state);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showedReconnecting = useRef(false);

  useEffect(() => {
    const prev = prevState.current;
    prevState.current = state;

    if (state === "connected") {
      // Clear any pending grace timer
      if (graceTimer.current) {
        clearTimeout(graceTimer.current);
        graceTimer.current = null;
      }

      if (!hasBeenConnected.current) {
        hasBeenConnected.current = true;
        return;
      }

      // Only show "Connected" if we previously showed "Reconnecting…"
      if (prev !== "connected" && showedReconnecting.current) {
        toast.success("Connected", { id: TOAST_ID, duration: 2000 });
        showedReconnecting.current = false;
      }
      return;
    }

    if (!hasBeenConnected.current) return;

    // Start grace period — only show toast if disconnection persists
    if (!graceTimer.current) {
      graceTimer.current = setTimeout(() => {
        graceTimer.current = null;
        showedReconnecting.current = true;
        toast.loading("Reconnecting…", { id: TOAST_ID, duration: Infinity });
      }, GRACE_PERIOD_MS);
    }
  }, [state]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (graceTimer.current) {
        clearTimeout(graceTimer.current);
      }
    };
  }, []);
}
