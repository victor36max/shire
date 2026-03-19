import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import AgentDashboard from "../react-components/AgentDashboard";
import { type Agent, type Project } from "../react-components/types";

const agents: Agent[] = [
  {
    name: "Agent One",
    status: "active",
    model: "claude-sonnet-4-6",
    harness: "claude_code",
  },
  {
    name: "Agent Two",
    status: "created",
    harness: "claude_code",
  },
];

const projects: Project[] = [
  { name: "test-project", status: "running" },
  { name: "other-project", status: "running" },
];

const defaultProps = {
  project: "test-project",
  projects,
  editAgent: null,
  pushEvent: vi.fn(),
};

describe("AgentDashboard", () => {
  it("renders sidebar with agents and welcome panel when none selected", () => {
    render(<AgentDashboard {...defaultProps} agents={agents} selectedAgent={null} />);
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
        {...defaultProps}
        agents={agents}
        selectedAgent={agents[0]}
        messages={[{ id: 1, role: "user", text: "Hello", ts: "2026-03-17T00:00:00Z" }]}
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
    render(<AgentDashboard {...defaultProps} agents={agents} selectedAgent={null} pushEvent={pushEvent} />);

    await userEvent.click(screen.getByText("Agent One"));
    expect(pushEvent).toHaveBeenCalledWith("select-agent", { name: "Agent One" });
  });

  it("opens new agent dialog from sidebar", async () => {
    render(<AgentDashboard {...defaultProps} agents={agents} selectedAgent={null} />);

    // Click the sidebar "+ New Agent" button
    await userEvent.click(screen.getAllByText("+ New Agent")[0]);
    expect(screen.getByText("Create a new agent to get started.")).toBeInTheDocument();
  });

  it("opens new agent dialog from welcome panel", async () => {
    render(<AgentDashboard {...defaultProps} agents={[]} selectedAgent={null} />);

    // Both sidebar and welcome panel have "+ New Agent" — click the welcome panel one
    const buttons = screen.getAllByText("+ New Agent");
    await userEvent.click(buttons[buttons.length - 1]);
    expect(screen.getByText("Create a new agent to get started.")).toBeInTheDocument();
  });
});
