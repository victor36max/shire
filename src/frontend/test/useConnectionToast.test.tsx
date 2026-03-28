import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach, mock } from "bun:test";
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

describe("useConnectionToast", () => {
  beforeEach(() => {
    mockState = "disconnected";
    (toast.loading as ReturnType<typeof mock>).mockClear();
    (toast.success as ReturnType<typeof mock>).mockClear();
  });

  it("does not show any toast on initial connection sequence", () => {
    // Start disconnected
    const { rerender } = renderHook(() => useConnectionToast());
    expect(toast.loading).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();

    // Move to connecting
    mockState = "connecting";
    rerender();
    expect(toast.loading).not.toHaveBeenCalled();

    // Move to connected (first time)
    mockState = "connected";
    rerender();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows loading toast when disconnected after being connected", () => {
    // Initial connect
    mockState = "connected";
    const { rerender } = renderHook(() => useConnectionToast());

    // Disconnect
    mockState = "disconnected";
    rerender();
    expect(toast.loading).toHaveBeenCalledWith("Reconnecting…", {
      id: "connection-status",
      duration: Infinity,
    });
  });

  it("shows success toast when reconnecting after disconnect", () => {
    // Initial connect
    mockState = "connected";
    const { rerender } = renderHook(() => useConnectionToast());

    // Disconnect
    mockState = "disconnected";
    rerender();

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

  it("shows loading toast when in connecting state after being connected", () => {
    mockState = "connected";
    const { rerender } = renderHook(() => useConnectionToast());

    mockState = "connecting";
    rerender();
    expect(toast.loading).toHaveBeenCalledWith("Reconnecting…", {
      id: "connection-status",
      duration: Infinity,
    });
  });
});
