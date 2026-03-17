import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import AgentSidebar from "../react-components/AgentSidebar";
import { type Agent } from "../react-components/types";

const agents: Agent[] = [
  {
    id: 1,
    name: "Active Agent",
    status: "active",
    model: "claude-sonnet-4-6",
    system_prompt: null,
    harness: "claude_code",
    recipe: "version: 1\nname: Active Agent\nharness: claude_code",
    is_base: false,
  },
  {
    id: 2,
    name: "Created Agent",
    status: "created",
    model: null,
    system_prompt: null,
    harness: "claude_code",
    recipe: "version: 1\nname: Created Agent\nharness: claude_code",
    is_base: false,
  },
  {
    id: 3,
    name: "Failed Agent",
    status: "failed",
    model: null,
    system_prompt: null,
    harness: "claude_code",
    recipe: "version: 1\nname: Failed Agent\nharness: claude_code",
    is_base: false,
  },
];

describe("AgentSidebar", () => {
  it("renders agent list with names", () => {
    render(
      <AgentSidebar
        agents={agents}
        selectedAgentId={null}
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
        selectedAgentId={null}
        onSelectAgent={vi.fn()}
        onNewAgent={vi.fn()}
        onDeleteAgent={vi.fn()}
      />,
    );
    expect(screen.getByText("No agents yet")).toBeInTheDocument();
  });

  it("calls onSelectAgent when clicking an agent", async () => {
    const onSelectAgent = vi.fn();
    render(
      <AgentSidebar
        agents={agents}
        selectedAgentId={null}
        onSelectAgent={onSelectAgent}
        onNewAgent={vi.fn()}
        onDeleteAgent={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByText("Active Agent"));
    expect(onSelectAgent).toHaveBeenCalledWith(1);
  });

  it("calls onNewAgent when clicking New Agent button", async () => {
    const onNewAgent = vi.fn();
    render(
      <AgentSidebar
        agents={agents}
        selectedAgentId={null}
        onSelectAgent={vi.fn()}
        onNewAgent={onNewAgent}
        onDeleteAgent={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByText("+ New Agent"));
    expect(onNewAgent).toHaveBeenCalled();
  });

  it("renders Settings and Shared Drive links", () => {
    render(
      <AgentSidebar
        agents={agents}
        selectedAgentId={null}
        onSelectAgent={vi.fn()}
        onNewAgent={vi.fn()}
        onDeleteAgent={vi.fn()}
      />,
    );
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Shared Drive")).toBeInTheDocument();
  });

  it("shows status dots with correct colors", () => {
    const { container } = render(
      <AgentSidebar
        agents={agents}
        selectedAgentId={null}
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
        selectedAgentId={null}
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
