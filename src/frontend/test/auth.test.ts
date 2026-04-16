import { describe, it, expect, beforeEach } from "bun:test";
import { getAccessToken, setAccessToken, refreshAccessToken } from "../lib/auth";
import { api } from "../lib/api";
import { http, HttpResponse } from "msw";
import { waitFor, act } from "@testing-library/react";
import { server } from "./msw-server";
import { renderHookWithProviders } from "./test-utils";
import { useAppConfig, useLogin, useLogout } from "../hooks/auth";

describe("auth token management", () => {
  beforeEach(() => {
    setAccessToken(null);
  });

  it("getAccessToken returns null initially", () => {
    expect(getAccessToken()).toBeNull();
  });

  it("setAccessToken stores and retrieves token", () => {
    setAccessToken("test-token");
    expect(getAccessToken()).toBe("test-token");
  });

  it("refreshAccessToken sets token on success", async () => {
    server.use(
      http.post("*/api/auth/refresh", () =>
        HttpResponse.json({ accessToken: "refreshed-token", username: "admin" }),
      ),
    );
    const token = await refreshAccessToken();
    expect(token).toBe("refreshed-token");
    expect(getAccessToken()).toBe("refreshed-token");
  });

  it("refreshAccessToken returns null on failure", async () => {
    server.use(http.post("*/api/auth/refresh", () => HttpResponse.json({}, { status: 401 })));
    const token = await refreshAccessToken();
    expect(token).toBeNull();
    expect(getAccessToken()).toBeNull();
  });
});

describe("useAppConfig", () => {
  it("fetches auth config", async () => {
    server.use(http.get("*/api/config", () => HttpResponse.json({ authEnabled: true })));
    const { result } = renderHookWithProviders(() => useAppConfig());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ authEnabled: true });
  });

  it("returns authEnabled false when auth is off", async () => {
    server.use(http.get("*/api/config", () => HttpResponse.json({ authEnabled: false })));
    const { result } = renderHookWithProviders(() => useAppConfig());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ authEnabled: false });
  });
});

describe("useLogin", () => {
  beforeEach(() => {
    setAccessToken(null);
  });

  it("sets access token on successful login", async () => {
    server.use(
      http.post("*/api/auth/login", () =>
        HttpResponse.json({ accessToken: "login-token", username: "admin" }),
      ),
    );
    const { result } = renderHookWithProviders(() => useLogin());
    act(() => result.current.mutate({ username: "admin", password: "secret" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getAccessToken()).toBe("login-token");
  });
});

describe("useLogout", () => {
  beforeEach(() => {
    setAccessToken("existing-token");
  });

  it("clears access token on logout", async () => {
    server.use(http.post("*/api/auth/logout", () => new HttpResponse(null, { status: 204 })));
    const { result } = renderHookWithProviders(() => useLogout());
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getAccessToken()).toBeNull();
  });
});

describe("api client auth integration", () => {
  beforeEach(() => {
    setAccessToken(null);
  });

  it("sends Authorization header when token is set", async () => {
    const captured: { auth: string | null } = { auth: null };
    server.use(
      http.get("*/api/config", ({ request }) => {
        captured.auth = request.headers.get("authorization");
        return HttpResponse.json({ authEnabled: false });
      }),
    );
    setAccessToken("my-token");
    await api.config.$get();
    expect(captured.auth).toBe("Bearer my-token");
  });

  it("sends no Authorization header when token is null", async () => {
    const captured: { auth: string | null } = { auth: null };
    server.use(
      http.get("*/api/config", ({ request }) => {
        captured.auth = request.headers.get("authorization");
        return HttpResponse.json({ authEnabled: false });
      }),
    );
    await api.config.$get();
    expect(captured.auth).toBeNull();
  });

  it("retries with refreshed token on 401", async () => {
    setAccessToken("expired-token");
    let callCount = 0;
    server.use(
      http.get("*/api/config", () => {
        callCount++;
        if (callCount === 1) return HttpResponse.json({}, { status: 401 });
        return HttpResponse.json({ authEnabled: true });
      }),
      http.post("*/api/auth/refresh", () =>
        HttpResponse.json({ accessToken: "new-token", username: "admin" }),
      ),
    );
    const res = await api.config.$get();
    expect(res.status).toBe(200);
    expect(getAccessToken()).toBe("new-token");
    expect(callCount).toBe(2);
  });
});
