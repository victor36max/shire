import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { type Agent } from "../components/types";
import { renderWithProviders } from "./test-utils";

const agent: Agent = {
  id: "a1",
  name: "Test Agent",
  status: "active",
  busy: false,
  unreadCount: 0,
  model: "claude-sonnet-4-6",
  systemPrompt: "You are a helpful assistant.",
  harness: "claude_code",
};

const restartMutate = vi.fn();
const deleteMutate = vi.fn();
const updateMutate = vi.fn();

let mockAgentDetail: Record<string, unknown> | undefined = { ...agent };
let mockAgentName = "Test Agent";
let mockAgentsList: Array<{ id: string; name: string; status: string }> = [
  { id: "a1", name: "Test Agent", status: "active" },
];

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useParams: () => ({ agentName: mockAgentName, projectName: "test-project" }),
  };
});

vi.mock("../lib/hooks", async () => {
  const actual = await vi.importActual("../lib/hooks");
  return {
    ...actual,
    useProjectId: () => ({ projectId: "p1", projectName: "test-project" }),
    useAgents: () => ({
      data: mockAgentsList,
      isLoading: false,
    }),
    useAgentDetail: () => ({ data: mockAgentDetail, isLoading: false }),
    useRestartAgent: () => ({ mutate: restartMutate, isPending: false }),
    useDeleteAgent: () => ({ mutate: deleteMutate, isPending: false }),
    useUpdateAgent: () => ({ mutate: updateMutate, isPending: false }),
  };
});

// Mock Terminal component to avoid xterm/canvas dependencies
vi.mock("../components/Terminal", () => ({
  default: ({ pushEvent: _pushEvent }: { pushEvent: unknown }) => (
    <div data-testid="terminal-mock">Terminal Component</div>
  ),
}));

import AgentShow from "../components/AgentShow";

async function openMoreMenu() {
  await userEvent.click(screen.getByRole("button", { name: "More actions" }));
}

beforeEach(() => {
  mockAgentDetail = { ...agent };
  mockAgentName = "Test Agent";
  mockAgentsList = [{ id: "a1", name: "Test Agent", status: "active" }];
  restartMutate.mockClear();
  deleteMutate.mockClear();
  updateMutate.mockClear();
});

describe("AgentShow", () => {
  it("renders agent details", () => {
    renderWithProviders(<AgentShow />);
    expect(screen.getByRole("heading", { name: "Test Agent" })).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
    expect(screen.getByText("You are a helpful assistant.")).toBeInTheDocument();
    expect(screen.getAllByText("active")).toHaveLength(2); // header badge + detail badge
  });

  it("shows fallback for missing model and system prompt", () => {
    mockAgentDetail = { ...agent, model: undefined, systemPrompt: undefined };
    renderWithProviders(<AgentShow />);
    expect(screen.getAllByText("Not set")).toHaveLength(2);
  });

  it("shows Start button for created agent", () => {
    mockAgentDetail = { ...agent, status: "created" };
    mockAgentsList = [{ id: "a1", name: "Test Agent", status: "created" }];
    renderWithProviders(<AgentShow />);
    expect(screen.getByText("Start Agent")).toBeInTheDocument();
  });

  it("shows Delete Agent in more menu", async () => {
    mockAgentDetail = { ...agent, status: "created" };
    renderWithProviders(<AgentShow />);
    await openMoreMenu();
    expect(screen.getByText("Delete Agent")).toBeInTheDocument();
  });

  it("shows Restart button for active agent", () => {
    renderWithProviders(<AgentShow />);
    expect(screen.getByText("Restart Agent")).toBeInTheDocument();
  });

  it("calls restartAgent.mutate when start is clicked", async () => {
    mockAgentDetail = { ...agent, status: "created" };
    mockAgentsList = [{ id: "a1", name: "Test Agent", status: "created" }];
    renderWithProviders(<AgentShow />);
    await userEvent.click(screen.getByText("Start Agent"));
    expect(restartMutate).toHaveBeenCalledWith("a1");
  });

  it("calls restartAgent.mutate after confirming restart", async () => {
    renderWithProviders(<AgentShow />);
    await userEvent.click(screen.getByText("Restart Agent"));
    await userEvent.click(screen.getByText("Restart"));
    expect(restartMutate).toHaveBeenCalledWith("a1");
  });

  it("calls deleteAgent.mutate after confirming via more menu", async () => {
    renderWithProviders(<AgentShow />);
    await openMoreMenu();
    await userEvent.click(screen.getByText("Delete Agent"));
    await userEvent.click(screen.getByText("Delete"));
    expect(deleteMutate).toHaveBeenCalledWith("a1");
  });

  it("shows Start button for crashed agent", () => {
    mockAgentDetail = { ...agent, status: "crashed" };
    mockAgentsList = [{ id: "a1", name: "Test Agent", status: "crashed" }];
    renderWithProviders(<AgentShow />);
    expect(screen.getByText("Start Agent")).toBeInTheDocument();
  });

  it("shows Restart button for bootstrapping agent", () => {
    mockAgentDetail = { ...agent, status: "bootstrapping" };
    mockAgentsList = [{ id: "a1", name: "Test Agent", status: "bootstrapping" }];
    renderWithProviders(<AgentShow />);
    expect(screen.getByText("Restart Agent")).toBeInTheDocument();
    expect(screen.queryByText("Start Agent")).not.toBeInTheDocument();
  });

  it("shows Start button for idle agent", () => {
    mockAgentDetail = { ...agent, status: "idle" };
    mockAgentsList = [{ id: "a1", name: "Test Agent", status: "idle" }];
    renderWithProviders(<AgentShow />);
    expect(screen.getByText("Start Agent")).toBeInTheDocument();
  });

  it("calls deleteAgent.mutate for created agent after confirming", async () => {
    mockAgentDetail = { ...agent, status: "created" };
    renderWithProviders(<AgentShow />);
    await openMoreMenu();
    await userEvent.click(screen.getByText("Delete Agent"));
    await userEvent.click(screen.getByText("Delete"));
    expect(deleteMutate).toHaveBeenCalledWith("a1");
  });

  it("displays harness badge", () => {
    renderWithProviders(<AgentShow />);
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("displays Pi harness", () => {
    mockAgentDetail = { ...agent, harness: "pi" };
    renderWithProviders(<AgentShow />);
    expect(screen.getByText("Pi")).toBeInTheDocument();
  });

  it("shows Edit button and opens edit form dialog", async () => {
    renderWithProviders(<AgentShow />);
    const editBtn = screen.getByRole("button", { name: /edit/i });
    expect(editBtn).toBeInTheDocument();
    await userEvent.click(editBtn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Edit Agent")).toBeInTheDocument();
  });

  it("renders system prompt in its own card", () => {
    renderWithProviders(<AgentShow />);
    expect(screen.getByText("System Prompt")).toBeInTheDocument();
    expect(screen.getByText("You are a helpful assistant.")).toBeInTheDocument();
  });
});
