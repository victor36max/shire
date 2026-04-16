import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "bun:test";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { server } from "./msw-server";
import { RequireAuth } from "../components/RequireAuth";
import { useAuthStore } from "../lib/auth";

function renderWithAuth(initialRoute = "/") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <React.Suspense fallback={<div>Loading...</div>}>
          <Routes>
            <Route path="/login" element={<div>Login Page</div>} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <div>Protected Content</div>
                </RequireAuth>
              }
            />
          </Routes>
        </React.Suspense>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RequireAuth", () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, refreshPromise: null });
  });

  it("renders children when auth is disabled", async () => {
    server.use(http.get("*/api/config", () => HttpResponse.json({ authEnabled: false })));
    renderWithAuth();
    await waitFor(() => expect(screen.getByText("Protected Content")).toBeTruthy());
  });

  it("redirects to /login when auth is enabled and no token", async () => {
    server.use(
      http.get("*/api/config", () => HttpResponse.json({ authEnabled: true })),
      http.post("*/api/auth/refresh", () => HttpResponse.json({}, { status: 401 })),
    );
    renderWithAuth();
    await waitFor(() => expect(screen.getByText("Login Page")).toBeTruthy());
  });

  it("renders children when auth is enabled and token exists", async () => {
    useAuthStore.setState({ accessToken: "valid-token" });
    server.use(http.get("*/api/config", () => HttpResponse.json({ authEnabled: true })));
    renderWithAuth();
    await waitFor(() => expect(screen.getByText("Protected Content")).toBeTruthy());
  });

  it("renders children after successful silent refresh", async () => {
    server.use(
      http.get("*/api/config", () => HttpResponse.json({ authEnabled: true })),
      http.post("*/api/auth/refresh", () =>
        HttpResponse.json({ accessToken: "refreshed-token", username: "admin" }),
      ),
    );
    renderWithAuth();
    await waitFor(() => expect(screen.getByText("Protected Content")).toBeTruthy());
  });
});
