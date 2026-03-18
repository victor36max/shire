import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import AgentSidebar from "../react-components/AgentSidebar";
import { type Agent } from "../react-components/types";

const agents: Agent[] = [
  {
    name: "Active Agent",
    status: "active",
    model: "claude-sonnet-4-6",
    harness: "claude_code",
  },
  {
    name: "Created Agent",
    status: "created",
    harness: "claude_code",
  },
  {
    name: "Failed Agent",
    status: "failed",
    harness: "claude_code",
  },
];

describe("AgentSidebar", () => {
  it("renders agent list with names", () => {
    render(
      <AgentSidebar
        agents={agents}
        selectedAgentName={null}
        onSelectAgent={vi.fn()}
        onNewAgent={vi.fn()}
        onDeleteAgent={vi.fn()}
      />,
    );
    expect(screen.getByText("Active Agent")).toBeInTheDocument();
    expect(screen.getByText("Created Agent")).toBeInTheDocument();
    expect(screen.getByText("Failed Agent")).toBeInTheDocument();
  });

  it("renders empty state when no agents", () => {
    render(
      <AgentSidebar
        agents={[]}
        selectedAgentName={null}
        onSelectAgent={vi.fn()}
        onNewAgent={vi.fn()}
        onDeleteAgent={vi.fn()}
      />,
    );
    expect(screen.getByText("No agents yet")).toBeInTheDocument();
  });

  it("calls onSelectAgent with name when clicking an agent", async () => {
    const onSelectAgent = vi.fn();
    render(
      <AgentSidebar
        agents={agents}
        selectedAgentName={null}
        onSelectAgent={onSelectAgent}
        onNewAgent={vi.fn()}
        onDeleteAgent={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByText("Active Agent"));
    expect(onSelectAgent).toHaveBeenCalledWith("Active Agent");
  });

  it("calls onNewAgent when clicking New Agent button", async () => {
    const onNewAgent = vi.fn();
    render(
      <AgentSidebar
        agents={agents}
        selectedAgentName={null}
        onSelectAgent={vi.fn()}
        onNewAgent={onNewAgent}
        onDeleteAgent={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByText("+ New Agent"));
    expect(onNewAgent).toHaveBeenCalled();
  });

  it("renders Settings link", () => {
    render(
      <AgentSidebar
        agents={agents}
        selectedAgentName={null}
        onSelectAgent={vi.fn()}
        onNewAgent={vi.fn()}
        onDeleteAgent={vi.fn()}
      />,
    );
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("shows status dots with correct colors", () => {
    const { container } = render(
      <AgentSidebar
        agents={agents}
        selectedAgentName={null}
        onSelectAgent={vi.fn()}
        onNewAgent={vi.fn()}
        onDeleteAgent={vi.fn()}
      />,
    );

    const dots = container.querySelectorAll(".rounded-full");
    expect(dots[0]).toHaveClass("bg-green-500"); // active
    expect(dots[1]).toHaveClass("bg-gray-400"); // created
    expect(dots[2]).toHaveClass("bg-red-500"); // failed
  });

  it("pulses the status dot when agent is active and busy", () => {
    const busyAgents: Agent[] = [
      { ...agents[0], busy: true },
      { ...agents[1], busy: false },
    ];
    const { container } = render(
      <AgentSidebar
        agents={busyAgents}
        selectedAgentName={null}
        onSelectAgent={vi.fn()}
        onNewAgent={vi.fn()}
        onDeleteAgent={vi.fn()}
      />,
    );

    const dots = container.querySelectorAll(".rounded-full");
    expect(dots[0]).toHaveClass("animate-pulse"); // active + busy
    expect(dots[1]).not.toHaveClass("animate-pulse"); // created + not busy
  });
});
