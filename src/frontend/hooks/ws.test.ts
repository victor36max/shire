import { describe, it, expect, beforeEach, mock } from "bun:test";
import { SignJWT } from "jose";
import { act, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw-server";
import { renderHookWithProviders } from "../test/test-utils";
import { useAuthStore } from "../stores/auth";
import { useWsConnect } from "../hooks/ws";

async function makeFakeJwt(): Promise<string> {
  const key = new TextEncoder().encode("test-secret");
  return new SignJWT({ sub: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("15m")
    .sign(key);
}

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

  it("does nothing while config is loading", () => {
    server.use(http.get("*/api/config", () => new Promise(() => {})));
    renderHookWithProviders(() => useWsConnect());
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  it("connects when auth is disabled", async () => {
    server.use(http.get("*/api/config", () => HttpResponse.json({ authEnabled: false })));
    renderHookWithProviders(() => useWsConnect());
    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1));
  });

  it("does not connect when auth is enabled and no token", async () => {
    server.use(http.get("*/api/config", () => HttpResponse.json({ authEnabled: true })));
    renderHookWithProviders(() => useWsConnect());
    // Wait for config to load, then verify no connect
    await waitFor(() => {});
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("connects when auth is enabled and token exists", async () => {
    useAuthStore.setState({ accessToken: await makeFakeJwt() });
    server.use(http.get("*/api/config", () => HttpResponse.json({ authEnabled: true })));
    renderHookWithProviders(() => useWsConnect());
    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1));
  });

  it("connects when token goes from null to non-null", async () => {
    server.use(http.get("*/api/config", () => HttpResponse.json({ authEnabled: true })));
    renderHookWithProviders(() => useWsConnect());
    await waitFor(() => {});
    expect(mockConnect).not.toHaveBeenCalled();

    const token = await makeFakeJwt();
    act(() => useAuthStore.setState({ accessToken: token }));
    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1));
  });

  it("does not reconnect when token changes to a different truthy value", async () => {
    useAuthStore.setState({ accessToken: await makeFakeJwt() });
    server.use(http.get("*/api/config", () => HttpResponse.json({ authEnabled: true })));
    renderHookWithProviders(() => useWsConnect());
    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1));

    mockConnect.mockClear();
    mockDisconnect.mockClear();

    const token2 = await makeFakeJwt();
    act(() => useAuthStore.setState({ accessToken: token2 }));
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  it("disconnects on unmount", async () => {
    server.use(http.get("*/api/config", () => HttpResponse.json({ authEnabled: false })));
    const { unmount } = renderHookWithProviders(() => useWsConnect());
    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1));

    mockDisconnect.mockClear();
    unmount();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
