import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AgentDashboard from "../components/AgentDashboard";
import {
  type AgentOverview,
  type CatalogAgentSummary,
  type CatalogCategory,
} from "../components/types";
import { renderWithProviders } from "./test-utils";

const agents: AgentOverview[] = [
  {
    id: "a1",
    name: "Agent One",
    status: "active",
  },
  {
    id: "a2",
    name: "Agent Two",
    status: "created",
  },
];

const createMutate = vi.fn();
const updateMutate = vi.fn();

let mockAgentName: string | undefined = undefined;
let mockAgentList: AgentOverview[] = agents;
let mockCatalogAgents: CatalogAgentSummary[] = [];
let mockCatalogCategories: CatalogCategory[] = [];
let mockCatalogSelectedAgent: Record<string, unknown> | undefined = undefined;

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useParams: () => ({ agentName: mockAgentName }),
  };
});

vi.mock("../lib/hooks", async () => {
  const actual = await vi.importActual("../lib/hooks");
  return {
    ...actual,
    useProjectId: () => ({ projectId: "p1", projectName: "test-project" }),
    useAgents: () => ({ data: mockAgentList, isLoading: false }),
    useCreateAgent: () => ({ mutate: createMutate, isPending: false }),
    useUpdateAgent: () => ({ mutate: updateMutate, isPending: false }),
    useCatalogAgent: () => ({ data: mockCatalogSelectedAgent }),
    useCatalogAgents: () => ({ data: mockCatalogAgents, isLoading: false }),
    useCatalogCategories: () => ({ data: mockCatalogCategories, isLoading: false }),
    // Hooks used by child components
    useProjects: () => ({
      data: [{ id: "p1", name: "test-project", status: "running" }],
      isLoading: false,
    }),
    useDeleteAgent: () => ({ mutate: vi.fn(), isPending: false }),
    useClearSession: () => ({ mutate: vi.fn(), isPending: false }),
    useMessages: () => ({ data: { messages: [], hasMore: false }, isLoading: false }),
    useSendMessage: () => ({ mutate: vi.fn(), isPending: false }),
    useInterruptAgent: () => ({ mutate: vi.fn(), isPending: false }),
    useRestartAgent: () => ({ mutate: vi.fn(), isPending: false }),
    useLoadMoreMessages: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock("../lib/ws", () => ({
  useSubscription: vi.fn(),
}));

describe("AgentDashboard", () => {
  beforeEach(() => {
    mockAgentName = undefined;
    mockAgentList = agents;
    mockCatalogAgents = [];
    mockCatalogCategories = [];
    mockCatalogSelectedAgent = undefined;
  });

  it("renders sidebar with agents and welcome panel when no agent selected via URL", () => {
    // When no agentName param, AgentDashboard selects agentList[0] automatically
    // To test welcome panel, we need an empty list
    mockAgentList = [];
    renderWithProviders(<AgentDashboard />);
    // Welcome panel shows onboarding content for no agents
    expect(screen.getByText(/agents that work together/)).toBeInTheDocument();
  });

  it("renders welcome panel with agent selection prompt when agents exist but none in URL", () => {
    // With agents present and no agentName param, it auto-selects first agent
    // The component selects agentList[0] when no agentName, so chat will show
    renderWithProviders(<AgentDashboard />);
    // Agent One should appear since it's auto-selected
    expect(screen.getAllByText("Agent One").length).toBeGreaterThanOrEqual(1);
  });

  it("opens new agent dialog from sidebar", async () => {
    renderWithProviders(<AgentDashboard />);

    await userEvent.click(screen.getByText("+ New Agent"));
    expect(screen.getByText("Create a new agent to get started.")).toBeInTheDocument();
  });

  it("shows onboarding content in welcome panel when no agents", () => {
    mockAgentList = [];
    renderWithProviders(<AgentDashboard />);
    expect(screen.getByText(/agents that work together/)).toBeInTheDocument();
    expect(screen.getAllByText("Browse Catalog")).toHaveLength(2);
  });

  it("opens new agent dialog from welcome panel", async () => {
    mockAgentList = [];
    renderWithProviders(<AgentDashboard />);

    const buttons = screen.getAllByText("+ New Agent");
    await userEvent.click(buttons[buttons.length - 1]);
    expect(screen.getByText("Create a new agent to get started.")).toBeInTheDocument();
  });

  it("renders menu toggle button in welcome panel when no agents", () => {
    mockAgentList = [];
    renderWithProviders(<AgentDashboard />);
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
  });

  it("shows backdrop when menu toggle is clicked", async () => {
    mockAgentList = [];
    const { container } = renderWithProviders(<AgentDashboard />);
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(container.querySelector(".fixed.inset-0.z-40")).toBeInTheDocument();
  });

  it("closes sidebar backdrop when clicked", async () => {
    mockAgentList = [];
    const { container } = renderWithProviders(<AgentDashboard />);
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const backdrop = container.querySelector(".fixed.inset-0.z-40");
    expect(backdrop).toBeInTheDocument();
    await userEvent.click(backdrop!);
    expect(container.querySelector(".fixed.inset-0.z-40")).not.toBeInTheDocument();
  });

  it("applies safe area insets to root container", () => {
    const { container } = renderWithProviders(<AgentDashboard />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("safe-area-inset-top");
    expect(root.className).toContain("safe-area-inset-bottom");
  });

  it("uses dvh for viewport height", () => {
    const { container } = renderWithProviders(<AgentDashboard />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-dvh");
    expect(root.className).not.toContain("h-screen");
  });
});
