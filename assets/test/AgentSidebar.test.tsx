import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import AgentSidebar from "../react-components/AgentSidebar";
import { type Agent, type Project } from "../react-components/types";

const agents: Agent[] = [
  {
    id: "a1",
    name: "Active Agent",
    status: "active",
    model: "claude-sonnet-4-6",
    harness: "claude_code",
  },
  {
    id: "a2",
    name: "Created Agent",
    status: "created",
    harness: "claude_code",
  },
  {
    id: "a3",
    name: "Idle Agent",
    status: "idle",
    harness: "claude_code",
  },
];

const projects: Project[] = [
  { id: "p1", name: "test-project", status: "running" },
  { id: "p2", name: "other-project", status: "running" },
];

const defaultProps = {
  project: { id: "p1", name: "test-project" },
  projects,
  selectedAgentId: null as string | null,
  onSelectAgent: vi.fn(),
  onNewAgent: vi.fn(),
  onDeleteAgent: vi.fn(),
  onBrowseCatalog: vi.fn(),
};

describe("AgentSidebar", () => {
  it("renders agent list with names", () => {
    render(<AgentSidebar {...defaultProps} agents={agents} />);
    expect(screen.getByText("Active Agent")).toBeInTheDocument();
    expect(screen.getByText("Created Agent")).toBeInTheDocument();
    expect(screen.getByText("Idle Agent")).toBeInTheDocument();
  });

  it("renders empty state when no agents", () => {
    render(<AgentSidebar {...defaultProps} agents={[]} />);
    expect(screen.getByText("No agents yet")).toBeInTheDocument();
  });

  it("calls onSelectAgent with name when clicking an agent", async () => {
    const onSelectAgent = vi.fn();
    render(<AgentSidebar {...defaultProps} agents={agents} onSelectAgent={onSelectAgent} />);

    await userEvent.click(screen.getByText("Active Agent"));
    expect(onSelectAgent).toHaveBeenCalledWith("a1");
  });

  it("calls onNewAgent when clicking New Agent button", async () => {
    const onNewAgent = vi.fn();
    render(<AgentSidebar {...defaultProps} agents={agents} onNewAgent={onNewAgent} />);

    await userEvent.click(screen.getByText("+ New Agent"));
    expect(onNewAgent).toHaveBeenCalled();
  });

  it("renders Project Details link", () => {
    render(<AgentSidebar {...defaultProps} agents={agents} />);
    expect(screen.getByText("Project Details")).toBeInTheDocument();
  });

  it("renders Settings link", () => {
    render(<AgentSidebar {...defaultProps} agents={agents} />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("shows status dots with correct colors", () => {
    const { container } = render(<AgentSidebar {...defaultProps} agents={agents} />);

    const dots = container.querySelectorAll(".rounded-full");
    expect(dots[0]).toHaveClass("bg-status-active"); // active
    expect(dots[1]).toHaveClass("bg-status-idle"); // created
    expect(dots[2]).toHaveClass("bg-status-idle"); // idle
  });

  it("pulses the status dot when agent is active and busy", () => {
    const busyAgents: Agent[] = [
      { ...agents[0], busy: true },
      { ...agents[1], busy: false },
    ];
    const { container } = render(<AgentSidebar {...defaultProps} agents={busyAgents} />);

    const dots = container.querySelectorAll(".rounded-full");
    expect(dots[0]).toHaveClass("animate-pulse"); // active + busy
    expect(dots[1]).not.toHaveClass("animate-pulse"); // created + not busy
  });

  it("calls onBrowseCatalog when clicking Browse Catalog button", async () => {
    const onBrowseCatalog = vi.fn();
    render(<AgentSidebar {...defaultProps} agents={agents} onBrowseCatalog={onBrowseCatalog} />);

    await userEvent.click(screen.getByText("Browse Catalog"));
    expect(onBrowseCatalog).toHaveBeenCalled();
  });
});
