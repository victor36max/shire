import { describe, it, expect, beforeEach, mock } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useAuthStore } from "../stores/auth";
import { useWsConnect } from "../hooks/useWsConnect";

const mockConnect = mock(() => {});
const mockDisconnect = mock(() => {});

mock.module("../lib/ws", () => ({
  getClient: () => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
  }),
}));

describe("useWsConnect", () => {
  beforeEach(() => {
    mockConnect.mockClear();
    mockDisconnect.mockClear();
    useAuthStore.setState({ accessToken: null, refreshPromise: null });
  });

  it("does nothing when authEnabled is undefined", () => {
    renderHook(() => useWsConnect(undefined));
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  it("connects immediately when auth is disabled", () => {
    renderHook(() => useWsConnect(false));
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("disconnects when auth is enabled and no token", () => {
    renderHook(() => useWsConnect(true));
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("connects when auth is enabled and token exists", () => {
    useAuthStore.setState({ accessToken: "some-token" });
    renderHook(() => useWsConnect(true));
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("reconnects when token goes from null to non-null", () => {
    const { rerender } = renderHook(() => useWsConnect(true));
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);

    mockConnect.mockClear();
    mockDisconnect.mockClear();

    act(() => useAuthStore.setState({ accessToken: "new-token" }));
    rerender();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("does not reconnect when token changes to a different truthy value", () => {
    useAuthStore.setState({ accessToken: "token-1" });
    const { rerender } = renderHook(() => useWsConnect(true));

    mockConnect.mockClear();
    mockDisconnect.mockClear();

    act(() => useAuthStore.setState({ accessToken: "token-2" }));
    rerender();

    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });
});
