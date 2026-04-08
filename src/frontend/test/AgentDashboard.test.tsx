import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, mock } from "bun:test";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import ProjectLayout from "../components/ProjectLayout";
import AgentChatView from "../components/AgentChatView";
import { type AgentOverview } from "../components/types";

mock.module("../lib/ws", () => ({
  useSubscription: mock(() => {}),
}));

const agents: AgentOverview[] = [
  {
    id: "a1",
    name: "Agent One",
    status: "active",
    busy: false,
    unreadCount: 0,
  },
  {
    id: "a2",
    name: "Agent Two",
    status: "created",
    busy: false,
    unreadCount: 0,
  },
];

function setAgents(agentList: AgentOverview[]) {
  server.use(http.get("*/api/projects/:id/agents", () => HttpResponse.json(agentList)));
}

function renderWithLayout(route = "/projects/test-project") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/projects/:projectName" element={<ProjectLayout />}>
            <Route index element={<AgentChatView />} />
            <Route path="agents/:agentName" element={<AgentChatView />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProjectLayout + AgentChatView", () => {
  it("renders sidebar with agents and welcome panel when no agents exist", async () => {
    setAgents([]);
    renderWithLayout();
    await waitFor(() => {
      expect(screen.getByText(/agents that work together/)).toBeInTheDocument();
    });
  });

  it("auto-selects first agent when no agent specified in URL", async () => {
    setAgents(agents);
    renderWithLayout();
    await waitFor(() => {
      expect(screen.getAllByText("Agent One").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("opens new agent dialog from sidebar", async () => {
    setAgents(agents);
    renderWithLayout();
    await waitFor(() => {
      expect(screen.getAllByText("+ New Agent").length).toBeGreaterThanOrEqual(1);
    });
    const buttons = screen.getAllByText("+ New Agent");
    await userEvent.click(buttons[0]);
    await waitFor(() => {
      expect(screen.getByText("Create a new agent to get started.")).toBeInTheDocument();
    });
  });

  it("shows onboarding content in welcome panel when no agents", async () => {
    setAgents([]);
    renderWithLayout();
    await waitFor(() => {
      expect(screen.getByText(/agents that work together/)).toBeInTheDocument();
    });
    expect(screen.getAllByText("Browse Catalog")).toHaveLength(2);
  });

  it("opens new agent dialog from welcome panel", async () => {
    setAgents([]);
    renderWithLayout();
    await waitFor(() => {
      expect(screen.getAllByText("+ New Agent").length).toBeGreaterThanOrEqual(1);
    });
    const buttons = screen.getAllByText("+ New Agent");
    await userEvent.click(buttons[buttons.length - 1]);
    expect(screen.getByText("Create a new agent to get started.")).toBeInTheDocument();
  });

  it("shows feature highlights in welcome panel when no agents", async () => {
    setAgents([]);
    renderWithLayout();
    await waitFor(() => {
      expect(screen.getByText("Chat with agents directly")).toBeInTheDocument();
    });
    expect(screen.getByText("Agents collaborate autonomously")).toBeInTheDocument();
    expect(screen.getByText("Shared drive for files")).toBeInTheDocument();
  });

  it("renders menu toggle button in welcome panel when no agents", async () => {
    setAgents([]);
    renderWithLayout();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
    });
  });

  it("shows backdrop when menu toggle is clicked", async () => {
    setAgents([]);
    const { container } = renderWithLayout();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(container.querySelector(".fixed.inset-0.z-40")).toBeInTheDocument();
  });

  it("closes sidebar backdrop when clicked", async () => {
    setAgents([]);
    const { container } = renderWithLayout();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const backdrop = container.querySelector(".fixed.inset-0.z-40");
    expect(backdrop).toBeInTheDocument();
    await userEvent.click(backdrop!);
    expect(container.querySelector(".fixed.inset-0.z-40")).not.toBeInTheDocument();
  });

  it("applies safe area insets to root container", async () => {
    setAgents(agents);
    const { container } = renderWithLayout();
    await waitFor(() => {
      expect(screen.getAllByText("Agent One").length).toBeGreaterThanOrEqual(1);
    });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("safe-area-inset-top");
    expect(root.className).toContain("safe-area-inset-bottom");
  });

  it("uses dvh for viewport height", async () => {
    setAgents(agents);
    const { container } = renderWithLayout();
    await waitFor(() => {
      expect(screen.getAllByText("Agent One").length).toBeGreaterThanOrEqual(1);
    });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-dvh");
    expect(root.className).not.toContain("h-screen");
  });

  it("renders selected agent when navigating to agent route", async () => {
    setAgents(agents);
    renderWithLayout("/projects/test-project/agents/Agent Two");
    await waitFor(() => {
      expect(screen.getAllByText("Agent Two").length).toBeGreaterThanOrEqual(1);
    });
  });
});
