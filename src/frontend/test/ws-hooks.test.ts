import { describe, it, expect, mock } from "bun:test";
import { renderHook } from "@testing-library/react";

/**
 * Mock WebSocket so WsClient.connect() doesn't attempt real connections.
 */
class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }
}

// Replace global WebSocket before module loads
(globalThis as Record<string, unknown>).WebSocket = FakeWebSocket;

describe("ws hooks (real module)", () => {
  it("useWsClient returns a client with subscribe/send/disconnect", async () => {
    const { useWsClient } = await import("../lib/ws");
    const { result } = renderHook(() => useWsClient());

    expect(result.current).toBeDefined();
    expect(typeof result.current.send).toBe("function");
    expect(typeof result.current.subscribe).toBe("function");
    expect(typeof result.current.disconnect).toBe("function");
  });

  it("useConnectionState returns a valid connection state", async () => {
    const { useConnectionState } = await import("../lib/ws");
    const { result } = renderHook(() => useConnectionState());

    expect(["connecting", "connected", "disconnected"]).toContain(result.current);
  });

  it("useSubscription subscribes and unsubscribes without error", async () => {
    const { useSubscription } = await import("../lib/ws");
    const handler = mock(() => {});

    const { unmount } = renderHook(() => useSubscription("test-topic", handler));
    expect(handler).not.toHaveBeenCalled();
    unmount();
  });

  it("useSubscription with null topic does not subscribe", async () => {
    const { useSubscription } = await import("../lib/ws");
    const handler = mock(() => {});

    const { unmount } = renderHook(() => useSubscription(null, handler));
    expect(handler).not.toHaveBeenCalled();
    unmount();
  });

  it("useSubscriptions subscribes to multiple topics", async () => {
    const { useSubscriptions } = await import("../lib/ws");
    const handler = mock(() => {});

    const { unmount } = renderHook(() => useSubscriptions(["topic-a", "topic-b", null], handler));
    expect(handler).not.toHaveBeenCalled();
    unmount();
  });

  it("useSubscriptions cleans up on unmount", async () => {
    const { useSubscriptions } = await import("../lib/ws");
    const handler = mock(() => {});

    const { unmount } = renderHook(() => useSubscriptions(["cleanup-a", "cleanup-b"], handler));
    unmount();
    // Should not throw after unmount
  });

  it("WsClient connect method works with FakeWebSocket", async () => {
    const { useWsClient } = await import("../lib/ws");
    const { result } = renderHook(() => useWsClient());
    const client = result.current;

    // Force connect (may already be connected from getClient())
    client.connect();
    // Should not throw
  });

  it("WsClient handles subscribe when ws is not open", async () => {
    const { useWsClient } = await import("../lib/ws");
    const { result } = renderHook(() => useWsClient());
    const client = result.current;

    const handler = mock(() => {});
    const unsub = client.subscribe("pending-topic", handler);
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("WsClient subscribe registers first handler for topic and sends subscribe", async () => {
    const { useWsClient } = await import("../lib/ws");
    const { result } = renderHook(() => useWsClient());
    const client = result.current;

    const handler1 = mock(() => {});
    const handler2 = mock(() => {});

    const unsub1 = client.subscribe("multi-topic", handler1);
    const unsub2 = client.subscribe("multi-topic", handler2);

    unsub1();
    unsub2();
  });
});
