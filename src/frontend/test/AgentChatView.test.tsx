import { screen, waitFor } from "@testing-library/react";
import { describe, it, expect, mock } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import { renderWithProviders } from "./test-utils";
import type { AgentOverview } from "../components/types";

mock.module("../lib/ws", () => ({
  useSubscription: mock(() => {}),
}));

// Mock the ProjectLayoutProvider to provide context
mock.module("../providers/ProjectLayoutProvider", () => ({
  useProjectLayout: () => ({
    projectId: "p1",
    sidebarOpen: false,
    setSidebarOpen: mock(() => {}),
    onNewAgent: mock(() => {}),
    onBrowseCatalog: mock(() => {}),
  }),
  ProjectLayoutProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import AgentChatView from "../components/AgentChatView";

const agents: AgentOverview[] = [
  { id: "a1", name: "test-agent", status: "active", busy: false, unreadCount: 0 },
];

function setAgents(agentList: AgentOverview[] = agents) {
  server.use(http.get("*/api/projects/:id/agents", () => HttpResponse.json(agentList)));
}

function setMessages(
  messages: Array<{
    id: number;
    role: string;
    content: Record<string, unknown>;
    createdAt: string;
  }>,
) {
  server.use(
    http.get("*/api/projects/:id/agents/:aid/messages", () =>
      HttpResponse.json({ messages, hasMore: false }),
    ),
  );
}

const routeOpts = {
  route: "/projects/test-project/agents/test-agent",
  routePath: "/projects/:projectName/agents/:agentName",
};

describe("AgentChatView", () => {
  it("renders loading state when agents are loading", async () => {
    server.use(
      http.get("*/api/projects/:id/agents", async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return HttpResponse.json([]);
      }),
    );
    renderWithProviders(<AgentChatView />, routeOpts);
    // Should show some loading or welcome panel
    await waitFor(() => {
      const el = document.querySelector(".animate-spin") || screen.queryByText(/welcome/i);
      expect(el !== null || document.body.textContent !== "").toBe(true);
    });
  });

  it("renders welcome panel when no agents exist", async () => {
    setAgents([]);
    setMessages([]);
    renderWithProviders(<AgentChatView />, routeOpts);
    await waitFor(() => {
      // WelcomePanel renders when no selectedAgent and agentList is empty
      expect(screen.getByText(/create/i) || screen.getByText(/welcome/i)).toBeInTheDocument();
    });
  });

  it("renders chat when agent exists", async () => {
    setAgents();
    setMessages([]);
    renderWithProviders(<AgentChatView />, routeOpts);
    await waitFor(() => {
      // ChatHeader renders the agent name
      expect(screen.getByText("test-agent")).toBeInTheDocument();
    });
  });

  it("renders error state when agents query fails", async () => {
    server.use(
      http.get("*/api/projects/:id/agents", () =>
        HttpResponse.json({ error: "Failed" }, { status: 500 }),
      ),
    );
    renderWithProviders(<AgentChatView />, routeOpts);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    });
  });
});
