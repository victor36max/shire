import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach } from "bun:test";
import { http, HttpResponse } from "msw";
import { SignJWT } from "jose";
import { server } from "../test/msw-server";
import { useAuthStore } from "../stores/auth";
import UserMenu from "./UserMenu";
import { renderWithProviders } from "../test/test-utils";

const resetStore = () => useAuthStore.setState({ accessToken: null, refreshPromise: null });

async function makeFakeJwt(sub = "admin"): Promise<string> {
  const key = new TextEncoder().encode("test-secret");
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("15m")
    .sign(key);
}

function enableAuth() {
  server.use(http.get("*/api/config", () => HttpResponse.json({ authEnabled: true })));
}

describe("UserMenu", () => {
  beforeEach(resetStore);

  it("renders nothing when auth is disabled", async () => {
    // Default MSW handler returns authEnabled: false
    const { container } = renderWithProviders(<UserMenu />);
    await waitFor(() => {
      expect(container.innerHTML).not.toContain("User menu");
    });
  });

  it("renders nothing when auth is enabled but no token", async () => {
    enableAuth();
    const { container } = renderWithProviders(<UserMenu />);
    await waitFor(() => {
      expect(container.innerHTML).not.toContain("User menu");
    });
  });

  it("renders user icon button when auth is enabled and logged in", async () => {
    enableAuth();
    const token = await makeFakeJwt("testuser");
    useAuthStore.setState({ accessToken: token });

    renderWithProviders(<UserMenu />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "User menu" })).toBeInTheDocument();
    });
  });

  it("shows username and logout in popover on click", async () => {
    enableAuth();
    const token = await makeFakeJwt("testuser");
    useAuthStore.setState({ accessToken: token });

    renderWithProviders(<UserMenu />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "User menu" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "User menu" }));
    expect(screen.getByText("testuser")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log out/i })).toBeInTheDocument();
  });

  it("calls logout on clicking Log out", async () => {
    enableAuth();
    const token = await makeFakeJwt("testuser");
    useAuthStore.setState({ accessToken: token });

    let logoutCalled = false;
    server.use(
      http.post("*/api/auth/logout", () => {
        logoutCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(<UserMenu />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "User menu" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "User menu" }));
    await userEvent.click(screen.getByRole("button", { name: /log out/i }));

    await waitFor(() => expect(logoutCalled).toBe(true));
  });

  it("shows username in trigger when sidebar variant", async () => {
    enableAuth();
    const token = await makeFakeJwt("sidebaruser");
    useAuthStore.setState({ accessToken: token });

    renderWithProviders(<UserMenu variant="sidebar" />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "User menu" })).toBeInTheDocument();
    });
    expect(screen.getByText("sidebaruser")).toBeInTheDocument();
  });

  it("hides username in popover for sidebar variant", async () => {
    enableAuth();
    const token = await makeFakeJwt("sidebaruser");
    useAuthStore.setState({ accessToken: token });

    renderWithProviders(<UserMenu variant="sidebar" />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "User menu" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "User menu" }));
    // Username appears only once (in the trigger), not duplicated in the popover
    expect(screen.getAllByText("sidebaruser")).toHaveLength(1);
  });
});
