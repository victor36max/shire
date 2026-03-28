import { useEffect, useRef, useSyncExternalStore } from "react";

export interface WsEvent {
  topic: string;
  type: string;
  payload?: Record<string, unknown>;
  message?: Record<string, unknown>;
}

export type ConnectionState = "connecting" | "connected" | "disconnected";

type EventHandler = (event: WsEvent) => void;
type StateListener = () => void;

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;

class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  private pendingSubscriptions = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private retryMs = INITIAL_RETRY_MS;
  private _connectionState: ConnectionState = "disconnected";
  private stateListeners = new Set<StateListener>();
  private intentionalClose = false;

  constructor() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.url = `${protocol}//${window.location.host}/ws`;
  }

  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  private setConnectionState(state: ConnectionState): void {
    if (this._connectionState === state) return;
    this._connectionState = state;
    for (const listener of this.stateListeners) {
      listener();
    }
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.setConnectionState("connecting");
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.retryMs = INITIAL_RETRY_MS;
      this.setConnectionState("connected");
      // Re-subscribe all active topics
      for (const topic of this.handlers.keys()) {
        this.send({ type: "subscribe", topic });
      }
      for (const topic of this.pendingSubscriptions) {
        this.send({ type: "subscribe", topic });
        this.pendingSubscriptions.delete(topic);
      }
    };

    this.ws.onmessage = (e) => {
      let data: WsEvent;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      const topicHandlers = this.handlers.get(data.topic);
      if (topicHandlers) {
        for (const handler of topicHandlers) {
          handler(data);
        }
      }
    };

    this.ws.onclose = () => {
      if (this.intentionalClose) {
        this.intentionalClose = false;
        return;
      }
      this.setConnectionState("disconnected");
      this.reconnectTimer = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    };
  }

  subscribe(topic: string, handler: EventHandler): () => void {
    let topicHandlers = this.handlers.get(topic);
    if (!topicHandlers) {
      topicHandlers = new Set();
      this.handlers.set(topic, topicHandlers);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: "subscribe", topic });
      } else {
        this.pendingSubscriptions.add(topic);
      }
    }
    topicHandlers.add(handler);

    return () => {
      topicHandlers!.delete(handler);
      if (topicHandlers!.size === 0) {
        this.handlers.delete(topic);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.send({ type: "unsubscribe", topic });
        }
      }
    };
  }

  send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.intentionalClose = true;
    this.ws?.close();
    this.ws = null;
    this.setConnectionState("disconnected");
  }
}

// Singleton WebSocket client
let client: WsClient | null = null;

function getClient(): WsClient {
  if (!client) {
    client = new WsClient();
    client.connect();
  }
  return client;
}

/**
 * Subscribe to a WebSocket topic. Automatically subscribes on mount
 * and unsubscribes on unmount or when the topic changes.
 */
export function useSubscription(topic: string | null, handler: EventHandler): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!topic) return;

    const wsClient = getClient();
    const unsub = wsClient.subscribe(topic, (event) => {
      handlerRef.current(event);
    });

    return unsub;
  }, [topic]);
}

/**
 * Subscribe to multiple WebSocket topics at once.
 */
export function useSubscriptions(topics: Array<string | null>, handler: EventHandler): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  const topicsKey = JSON.stringify(topics);

  useEffect(() => {
    const wsClient = getClient();
    const unsubs: Array<() => void> = [];
    const currentTopics = JSON.parse(topicsKey) as Array<string | null>;

    for (const topic of currentTopics) {
      if (!topic) continue;
      unsubs.push(
        wsClient.subscribe(topic, (event) => {
          handlerRef.current(event);
        }),
      );
    }

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [topicsKey]);
}

/**
 * Get the raw WebSocket client for sending messages (e.g., terminal input).
 */
export function useWsClient(): WsClient {
  return getClient();
}

/**
 * Returns the current WebSocket connection state, reactively updated.
 */
export function useConnectionState(): ConnectionState {
  const wsClient = getClient();
  return useSyncExternalStore(
    (cb) => wsClient.onStateChange(cb),
    () => wsClient.connectionState,
  );
}
