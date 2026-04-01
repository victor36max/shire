import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import SettingsPage from "../components/SettingsPage";
import { renderWithProviders } from "./test-utils";

mock.module("../lib/ws", () => ({
  useSubscription: mock(() => {}),
}));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

const routeOpts = {
  route: "/projects/test-project/settings",
  routePath: "/projects/:projectName/settings",
};

describe("SettingsPage", () => {
  it("renders with Settings heading", async () => {
    renderWithProviders(<SettingsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    });
  });

  it("has Back button", async () => {
    renderWithProviders(<SettingsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    });
  });

  it("shows Activity Log tab by default with messages", async () => {
    server.use(
      http.get("*/api/projects/:id/activity", () =>
        HttpResponse.json({
          messages: [
            {
              id: 1,
              fromAgent: "Alice",
              toAgent: "Bob",
              text: "Hello!",
              ts: "2026-03-17T10:00:00Z",
            },
          ],
          hasMore: false,
        }),
      ),
    );
    renderWithProviders(<SettingsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Hello!")).toBeInTheDocument();
    });
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows empty state on Activity Log tab when no messages", async () => {
    renderWithProviders(<SettingsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText(/No inter-agent messages yet/)).toBeInTheDocument();
    });
  });

  it("shows Appearance tab with theme options", async () => {
    renderWithProviders(<SettingsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Appearance")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Appearance"));
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("defaults to System theme active in Appearance tab", async () => {
    renderWithProviders(<SettingsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Appearance")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Appearance"));
    const systemButton = screen.getByRole("button", { name: /System/ });
    expect(systemButton.getAttribute("data-active")).toBe("true");
  });

  it("highlights current theme in Appearance tab", async () => {
    localStorage.setItem("theme", "dark");
    renderWithProviders(<SettingsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Appearance")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Appearance"));
    const darkButton = screen.getByRole("button", { name: /Dark/ });
    expect(darkButton.getAttribute("data-active")).toBe("true");
  });

  it("switches theme when clicking a theme option", async () => {
    renderWithProviders(<SettingsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Appearance")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Appearance"));
    await userEvent.click(screen.getByRole("button", { name: /Dark/ }));
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes .dark class when switching to Light", async () => {
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.add("dark");
    renderWithProviders(<SettingsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Appearance")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Appearance"));
    await userEvent.click(screen.getByRole("button", { name: /Light/ }));
    expect(localStorage.getItem("theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
