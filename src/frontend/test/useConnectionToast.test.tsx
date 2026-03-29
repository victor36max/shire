import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { toast } from "sonner";
import { useConnectionToast } from "../lib/useConnectionToast";

let mockState = "disconnected";

mock.module("../lib/ws", () => ({
  useConnectionState: () => mockState,
}));

mock.module("sonner", () => ({
  toast: {
    loading: mock(() => {}),
    success: mock(() => {}),
  },
}));

const GRACE_PERIOD_MS = 10_000;

describe("useConnectionToast", () => {
  let originalSetTimeout: typeof globalThis.setTimeout;
  let originalClearTimeout: typeof globalThis.clearTimeout;
  let timers: Array<{ callback: () => void; delay: number; id: number }>;
  let nextId: number;

  beforeEach(() => {
    mockState = "disconnected";
    (toast.loading as ReturnType<typeof mock>).mockClear();
    (toast.success as ReturnType<typeof mock>).mockClear();

    // Install fake timers
    timers = [];
    nextId = 1;
    originalSetTimeout = globalThis.setTimeout;
    originalClearTimeout = globalThis.clearTimeout;

    // @ts-expect-error -- fake timer returns number id
    globalThis.setTimeout = (cb: () => void, delay: number) => {
      const id = nextId++;
      timers.push({ callback: cb, delay, id });
      return id;
    };
    const fakeClearTimeout = (
      id: number | string | ReturnType<typeof originalSetTimeout> | undefined,
    ) => {
      timers = timers.filter((t) => t.id !== id);
    };
    globalThis.clearTimeout = fakeClearTimeout as typeof globalThis.clearTimeout;
  });

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  function advanceTimers() {
    const pending = [...timers];
    timers = [];
    for (const t of pending) {
      t.callback();
    }
  }

  it("does not show any toast on initial connection sequence", () => {
    const { rerender } = renderHook(() => useConnectionToast());
    expect(toast.loading).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();

    mockState = "connecting";
    rerender();
    expect(toast.loading).not.toHaveBeenCalled();

    mockState = "connected";
    rerender();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does not show toast immediately on disconnect", () => {
    mockState = "connected";
    const { rerender } = renderHook(() => useConnectionToast());

    mockState = "disconnected";
    rerender();

    // Toast should NOT appear yet — grace period hasn't elapsed
    expect(toast.loading).not.toHaveBeenCalled();
  });

  it("shows reconnecting toast after grace period elapses", () => {
    mockState = "connected";
    const { rerender } = renderHook(() => useConnectionToast());

    mockState = "disconnected";
    rerender();

    expect(timers).toHaveLength(1);
    expect(timers[0].delay).toBe(GRACE_PERIOD_MS);

    advanceTimers();

    expect(toast.loading).toHaveBeenCalledWith("Reconnecting…", {
      id: "connection-status",
      duration: Infinity,
    });
  });

  it("does not show any toast if reconnection happens within grace period", () => {
    mockState = "connected";
    const { rerender } = renderHook(() => useConnectionToast());

    // Disconnect
    mockState = "disconnected";
    rerender();

    // Reconnect before grace period fires
    mockState = "connected";
    rerender();

    // Timer should have been cleared
    advanceTimers();

    expect(toast.loading).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows success toast on reconnect only if reconnecting toast was shown", () => {
    mockState = "connected";
    const { rerender } = renderHook(() => useConnectionToast());

    mockState = "disconnected";
    rerender();

    // Grace period elapses — reconnecting toast shown
    advanceTimers();
    expect(toast.loading).toHaveBeenCalled();

    // Reconnect
    mockState = "connected";
    rerender();
    expect(toast.success).toHaveBeenCalledWith("Connected", {
      id: "connection-status",
      duration: 2000,
    });
  });

  it("does not show toast when initial state is connecting", () => {
    mockState = "connecting";
    renderHook(() => useConnectionToast());
    expect(toast.loading).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does not show toast after unmount during grace period", () => {
    mockState = "connected";
    const { rerender, unmount } = renderHook(() => useConnectionToast());

    mockState = "disconnected";
    rerender();
    expect(timers).toHaveLength(1);

    unmount();

    advanceTimers();
    expect(toast.loading).not.toHaveBeenCalled();
  });

  it("starts grace period when going from connected to connecting", () => {
    mockState = "connected";
    const { rerender } = renderHook(() => useConnectionToast());

    mockState = "connecting";
    rerender();

    // Should have started the grace timer, not shown toast yet
    expect(toast.loading).not.toHaveBeenCalled();
    expect(timers).toHaveLength(1);

    advanceTimers();
    expect(toast.loading).toHaveBeenCalledWith("Reconnecting…", {
      id: "connection-status",
      duration: Infinity,
    });
  });
});
