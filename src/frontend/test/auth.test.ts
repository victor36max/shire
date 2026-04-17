import { describe, it, expect, beforeEach } from "bun:test";
import { SignJWT } from "jose";
import { useAuthStore, getAccessToken, isTokenExpired } from "../stores/auth";
import { api } from "../lib/api";
import { http, HttpResponse } from "msw";
import { waitFor, act } from "@testing-library/react";
import { server } from "./msw-server";
import { renderHookWithProviders } from "./test-utils";
import { useAppConfig, useLogin, useLogout } from "../hooks/auth";

const { setState } = useAuthStore;
const resetStore = () => setState({ accessToken: null, refreshPromise: null });

async function makeFakeJwt(expiresIn = "15m"): Promise<string> {
  const key = new TextEncoder().encode("test-secret");
  return new SignJWT({ sub: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .sign(key);
}

async function makeExpiredJwt(): Promise<string> {
  return makeFakeJwt("-1s");
}

describe("auth token management", () => {
  beforeEach(resetStore);

  it("getAccessToken returns null initially", () => {
    expect(getAccessToken()).toBeNull();
  });

  it("setAccessToken stores and retrieves token", () => {
    setState({ accessToken: "test-token" });
    expect(getAccessToken()).toBe("test-token");
  });

  it("refreshAccessToken sets token on success", async () => {
    server.use(
      http.post("*/api/auth/refresh", () =>
        HttpResponse.json({ accessToken: "refreshed-token", username: "admin" }),
      ),
    );
    const token = await useAuthStore.getState().refreshAccessToken();
    expect(token).toBe("refreshed-token");
    expect(getAccessToken()).toBe("refreshed-token");
  });

  it("refreshAccessToken returns null on failure", async () => {
    server.use(http.post("*/api/auth/refresh", () => HttpResponse.json({}, { status: 401 })));
    const token = await useAuthStore.getState().refreshAccessToken();
    expect(token).toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it("deduplicates concurrent refresh calls into a single request", async () => {
    let callCount = 0;
    server.use(
      http.post("*/api/auth/refresh", () => {
        callCount++;
        return HttpResponse.json({ accessToken: "deduped-token", username: "admin" });
      }),
    );
    const { refreshAccessToken } = useAuthStore.getState();
    const [t1, t2, t3] = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ]);
    expect(callCount).toBe(1);
    expect(t1).toBe("deduped-token");
    expect(t2).toBe("deduped-token");
    expect(t3).toBe("deduped-token");
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
  beforeEach(resetStore);

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
  beforeEach(() => setState({ accessToken: "existing-token" }));

  it("clears access token on logout", async () => {
    server.use(http.post("*/api/auth/logout", () => new HttpResponse(null, { status: 204 })));
    const { result } = renderHookWithProviders(() => useLogout());
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getAccessToken()).toBeNull();
  });
});

describe("api client auth integration", () => {
  beforeEach(resetStore);

  it("sends Authorization header when token is set", async () => {
    const token = await makeFakeJwt();
    const captured: { auth: string | null } = { auth: null };
    server.use(
      http.get("*/api/config", ({ request }) => {
        captured.auth = request.headers.get("authorization");
        return HttpResponse.json({ authEnabled: false });
      }),
    );
    setState({ accessToken: token });
    await api.config.$get();
    expect(captured.auth).toBe(`Bearer ${token}`);
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

  it("refreshes and retries on 401", async () => {
    const token = await makeFakeJwt();
    setState({ accessToken: token });
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

  it("clears token when refresh fails after 401", async () => {
    const token = await makeFakeJwt();
    setState({ accessToken: token });
    server.use(
      http.get("*/api/config", () => HttpResponse.json({}, { status: 401 })),
      http.post("*/api/auth/refresh", () => HttpResponse.json({}, { status: 401 })),
    );
    await api.config.$get();
    expect(getAccessToken()).toBeNull();
  });

  it("proactively refreshes expired token before making request", async () => {
    const expiredToken = await makeExpiredJwt();
    const freshToken = await makeFakeJwt();
    setState({ accessToken: expiredToken });
    let refreshCalled = false;
    const captured: { auth: string | null } = { auth: null };
    server.use(
      http.post("*/api/auth/refresh", () => {
        refreshCalled = true;
        return HttpResponse.json({ accessToken: freshToken, username: "admin" });
      }),
      http.get("*/api/config", ({ request }) => {
        captured.auth = request.headers.get("authorization");
        return HttpResponse.json({ authEnabled: true });
      }),
    );
    const res = await api.config.$get();
    expect(res.status).toBe(200);
    expect(refreshCalled).toBe(true);
    expect(captured.auth).toBe(`Bearer ${freshToken}`);
    expect(getAccessToken()).toBe(freshToken);
  });

  it("does not refresh a valid token before request", async () => {
    const validToken = await makeFakeJwt();
    setState({ accessToken: validToken });
    let refreshCalled = false;
    server.use(
      http.post("*/api/auth/refresh", () => {
        refreshCalled = true;
        return HttpResponse.json({ accessToken: "should-not-be-used", username: "admin" });
      }),
      http.get("*/api/config", () => HttpResponse.json({ authEnabled: true })),
    );
    await api.config.$get();
    expect(refreshCalled).toBe(false);
    expect(getAccessToken()).toBe(validToken);
  });
});

describe("isTokenExpired", () => {
  it("returns false for a valid non-expired token", async () => {
    const token = await makeFakeJwt();
    expect(isTokenExpired(token)).toBe(false);
  });

  it("returns true for an expired token", async () => {
    const token = await makeExpiredJwt();
    expect(isTokenExpired(token)).toBe(true);
  });

  it("returns true for a malformed token", () => {
    expect(isTokenExpired("not-a-jwt")).toBe(true);
  });
});
