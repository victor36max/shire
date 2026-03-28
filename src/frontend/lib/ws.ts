import { useEffect, useRef } from "react";

export interface WsEvent {
  topic: string;
  type: string;
  payload?: Record<string, unknown>;
  message?: Record<string, unknown>;
}

type EventHandler = (event: WsEvent) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  private pendingSubscriptions = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;

  constructor() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.url = `${protocol}//${window.location.host}/ws`;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
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
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
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
    this.ws?.close();
    this.ws = null;
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

  const topicsKey = topics.join(",");

  useEffect(() => {
    const wsClient = getClient();
    const unsubs: Array<() => void> = [];
    const currentTopics = topicsKey.split(",");

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
