import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { getClient, type WsEvent, type EventHandler, type ConnectionState } from "../lib/ws";
import { useAuthStore } from "../stores/auth";
import { useAppConfig } from "./auth";

export function useSubscription<E extends WsEvent = WsEvent>(
  topic: string | null,
  handler: EventHandler<E>,
): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!topic) return;

    const wsClient = getClient();
    const unsub = wsClient.subscribe<E>(topic, (event) => {
      handlerRef.current(event);
    });

    return unsub;
  }, [topic]);
}

export function useWsClient() {
  return getClient();
}

export function useConnectionState(): ConnectionState {
  const wsClient = getClient();
  return useSyncExternalStore(
    (cb) => wsClient.onStateChange(cb),
    () => wsClient.connectionState,
  );
}

export function useWsConnect(): void {
  const { data: config } = useAppConfig();
  const hasToken = useAuthStore((s) => !!s.accessToken);

  const authEnabled = useMemo(() => config?.authEnabled, [config?.authEnabled]);

  useEffect(() => {
    const wsClient = getClient();
    if (authEnabled === undefined) return;
    if (authEnabled && !hasToken) return;

    wsClient.connect();
    return () => wsClient.disconnect();
  }, [authEnabled, hasToken]);
}
