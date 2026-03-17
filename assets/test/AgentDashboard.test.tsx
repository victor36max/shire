import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import AgentDashboard from "../react-components/AgentDashboard";
import { type Agent } from "../react-components/types";

const agents: Agent[] = [
  {
    id: 1,
    name: "Agent One",
    status: "active",
    model: "claude-sonnet-4-6",
    system_prompt: null,
    harness: "claude_code",
    recipe: "version: 1\nname: Agent One\nharness: claude_code\nmodel: claude-sonnet-4-6",
    is_base: false,
  },
  {
    id: 2,
    name: "Agent Two",
    status: "created",
    model: null,
    system_prompt: null,
    harness: "claude_code",
    recipe: "version: 1\nname: Agent Two\nharness: claude_code",
    is_base: false,
  },
];

describe("AgentDashboard", () => {
  it("renders sidebar with agents and welcome panel when none selected", () => {
    render(<AgentDashboard agents={agents} selectedAgent={null} editAgent={null} pushEvent={vi.fn()} />);
    // Sidebar shows agents
    expect(screen.getByText("Agent One")).toBeInTheDocument();
    expect(screen.getByText("Agent Two")).toBeInTheDocument();
    // Welcome panel shows
    expect(screen.getByText("Shire")).toBeInTheDocument();
    expect(screen.getByText("Select an agent from the sidebar to start chatting.")).toBeInTheDocument();
  });

  it("renders chat panel when agent is selected", () => {
    render(
      <AgentDashboard
        agents={agents}
        selectedAgent={agents[0]}
        messages={[{ id: 1, role: "user", text: "Hello", ts: "2026-03-17T00:00:00Z" }]}
        editAgent={null}
        pushEvent={vi.fn()}
      />,
    );
    // Chat header shows
    expect(screen.getAllByText("Agent One").length).toBeGreaterThanOrEqual(1);
    // Message shows
    expect(screen.getByText("Hello")).toBeInTheDocument();
    // Welcome panel should not show
    expect(screen.queryByText("Select an agent from the sidebar to start chatting.")).not.toBeInTheDocument();
  });

  it("calls pushEvent with select-agent when clicking sidebar agent", async () => {
    const pushEvent = vi.fn();
    render(<AgentDashboard agents={agents} selectedAgent={null} editAgent={null} pushEvent={pushEvent} />);

    await userEvent.click(screen.getByText("Agent One"));
    expect(pushEvent).toHaveBeenCalledWith("select-agent", { id: 1 });
  });

  it("opens new agent dialog from sidebar", async () => {
    render(<AgentDashboard agents={agents} selectedAgent={null} editAgent={null} pushEvent={vi.fn()} />);

    // Click the sidebar "+ New Agent" button
    await userEvent.click(screen.getAllByText("+ New Agent")[0]);
    expect(screen.getByText("Create a new agent to get started.")).toBeInTheDocument();
  });

  it("opens new agent dialog from welcome panel", async () => {
    render(<AgentDashboard agents={[]} selectedAgent={null} editAgent={null} pushEvent={vi.fn()} />);

    // Both sidebar and welcome panel have "+ New Agent" — click the welcome panel one
    const buttons = screen.getAllByText("+ New Agent");
    await userEvent.click(buttons[buttons.length - 1]);
    expect(screen.getByText("Create a new agent to get started.")).toBeInTheDocument();
  });
});
