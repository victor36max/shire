import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProjectLayout from "../components/ProjectLayout";
import AgentChatView from "../components/AgentChatView";
import {
  type AgentOverview,
  type CatalogAgentSummary,
  type CatalogCategory,
} from "../components/types";

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

const createMutate = vi.fn();
const updateMutate = vi.fn();

let mockAgentList: AgentOverview[] = agents;
let mockCatalogAgents: CatalogAgentSummary[] = [];
let mockCatalogCategories: CatalogCategory[] = [];
let mockCatalogSelectedAgent: Record<string, unknown> | undefined = undefined;

vi.mock("../lib/hooks", async () => {
  const actual = await vi.importActual("../lib/hooks");
  return {
    ...actual,
    useProjectId: () => ({ projectId: "p1", projectName: "test-project" }),
    useResolveProjectId: () => "p1",
    useAgents: () => ({ data: mockAgentList, isLoading: false }),
    useCreateAgent: () => ({ mutate: createMutate, isPending: false }),
    useUpdateAgent: () => ({ mutate: updateMutate, isPending: false }),
    useCatalogAgent: () => ({ data: mockCatalogSelectedAgent }),
    useCatalogAgents: () => ({ data: mockCatalogAgents, isLoading: false }),
    useCatalogCategories: () => ({ data: mockCatalogCategories, isLoading: false }),
    useProjects: () => ({
      data: [{ id: "p1", name: "test-project", status: "running" }],
      isLoading: false,
    }),
    useDeleteAgent: () => ({ mutate: vi.fn(), isPending: false }),
    useClearSession: () => ({ mutate: vi.fn(), isPending: false }),
    useMessages: () => ({
      data: {
        pages: [{ messages: [], hasMore: false }],
        pageParams: [undefined],
      },
      isLoading: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    }),
    useSendMessage: () => ({ mutate: vi.fn(), isPending: false }),
    useInterruptAgent: () => ({ mutate: vi.fn(), isPending: false }),
    useRestartAgent: () => ({ mutate: vi.fn(), isPending: false }),
    useMarkRead: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock("../lib/ws", () => ({
  useSubscription: vi.fn(),
}));

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
  beforeEach(() => {
    mockAgentList = agents;
    mockCatalogAgents = [];
    mockCatalogCategories = [];
    mockCatalogSelectedAgent = undefined;
  });

  it("renders sidebar with agents and welcome panel when no agents exist", () => {
    mockAgentList = [];
    renderWithLayout();
    expect(screen.getByText(/agents that work together/)).toBeInTheDocument();
  });

  it("auto-selects first agent when no agent specified in URL", () => {
    renderWithLayout();
    expect(screen.getAllByText("Agent One").length).toBeGreaterThanOrEqual(1);
  });

  it("opens new agent dialog from sidebar", async () => {
    renderWithLayout();
    await userEvent.click(screen.getByText("+ New Agent"));
    expect(screen.getByText("Create a new agent to get started.")).toBeInTheDocument();
  });

  it("shows onboarding content in welcome panel when no agents", () => {
    mockAgentList = [];
    renderWithLayout();
    expect(screen.getByText(/agents that work together/)).toBeInTheDocument();
    expect(screen.getAllByText("Browse Catalog")).toHaveLength(2);
  });

  it("opens new agent dialog from welcome panel", async () => {
    mockAgentList = [];
    renderWithLayout();
    const buttons = screen.getAllByText("+ New Agent");
    await userEvent.click(buttons[buttons.length - 1]);
    expect(screen.getByText("Create a new agent to get started.")).toBeInTheDocument();
  });

  it("renders menu toggle button in welcome panel when no agents", () => {
    mockAgentList = [];
    renderWithLayout();
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
  });

  it("shows backdrop when menu toggle is clicked", async () => {
    mockAgentList = [];
    const { container } = renderWithLayout();
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(container.querySelector(".fixed.inset-0.z-40")).toBeInTheDocument();
  });

  it("closes sidebar backdrop when clicked", async () => {
    mockAgentList = [];
    const { container } = renderWithLayout();
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const backdrop = container.querySelector(".fixed.inset-0.z-40");
    expect(backdrop).toBeInTheDocument();
    await userEvent.click(backdrop!);
    expect(container.querySelector(".fixed.inset-0.z-40")).not.toBeInTheDocument();
  });

  it("applies safe area insets to root container", () => {
    const { container } = renderWithLayout();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("safe-area-inset-top");
    expect(root.className).toContain("safe-area-inset-bottom");
  });

  it("uses dvh for viewport height", () => {
    const { container } = renderWithLayout();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-dvh");
    expect(root.className).not.toContain("h-screen");
  });

  it("renders selected agent when navigating to agent route", () => {
    renderWithLayout("/projects/test-project/agents/Agent Two");
    expect(screen.getAllByText("Agent Two").length).toBeGreaterThanOrEqual(1);
  });
});
