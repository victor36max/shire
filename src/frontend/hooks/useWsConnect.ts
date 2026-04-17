import { useEffect } from "react";
import { useAuthStore } from "../stores/auth";
import { getClient } from "../lib/ws";

export function useWsConnect(authEnabled: boolean | undefined): void {
  const hasToken = useAuthStore((s) => !!s.accessToken);

  useEffect(() => {
    const wsClient = getClient();

    if (authEnabled === undefined) return;

    if (!authEnabled || hasToken) {
      wsClient.disconnect();
      wsClient.connect();
    } else {
      wsClient.disconnect();
    }
  }, [authEnabled, hasToken]);
}
