import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { type Agent } from "../react-components/types";

// Mock Terminal component to avoid xterm/canvas dependencies
vi.mock("../react-components/Terminal", () => ({
  default: ({ pushEvent: _pushEvent }: { pushEvent: unknown }) => (
    <div data-testid="terminal-mock">Terminal Component</div>
  ),
}));

import AgentShow from "../react-components/AgentShow";

const agent: Agent = {
  id: "a1",
  name: "Test Agent",
  status: "active",
  model: "claude-sonnet-4-6",
  system_prompt: "You are a helpful assistant.",
  harness: "claude_code",
};

describe("AgentShow", () => {
  it("renders agent details", () => {
    render(<AgentShow project={{ id: "p1", name: "test-project" }} agent={agent} pushEvent={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Test Agent" })).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
    expect(screen.getByText("You are a helpful assistant.")).toBeInTheDocument();
    expect(screen.getAllByText("active")).toHaveLength(2); // header badge + detail badge
  });

  it("shows fallback for missing model and system prompt", () => {
    render(
      <AgentShow
        project={{ id: "p1", name: "test-project" }}
        agent={{ ...agent, model: undefined, system_prompt: undefined }}
        pushEvent={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Not set")).toHaveLength(2);
  });

  it("shows Start and Delete buttons for created agent", () => {
    render(
      <AgentShow
        project={{ id: "p1", name: "test-project" }}
        agent={{ ...agent, status: "created" }}
        pushEvent={vi.fn()}
      />,
    );
    expect(screen.getByText("Start Agent")).toBeInTheDocument();
    expect(screen.getByText("Delete Agent")).toBeInTheDocument();
  });

  it("shows Restart and Delete buttons for active agent", () => {
    render(
      <AgentShow
        project={{ id: "p1", name: "test-project" }}
        agent={{ ...agent, status: "active" }}
        pushEvent={vi.fn()}
      />,
    );
    expect(screen.getByText("Restart Agent")).toBeInTheDocument();
    expect(screen.getByText("Delete Agent")).toBeInTheDocument();
  });

  it("calls pushEvent with start-agent", async () => {
    const pushEvent = vi.fn();
    render(
      <AgentShow
        project={{ id: "p1", name: "test-project" }}
        agent={{ ...agent, status: "created" }}
        pushEvent={pushEvent}
      />,
    );
    await userEvent.click(screen.getByText("Start Agent"));
    expect(pushEvent).toHaveBeenCalledWith("start-agent", {});
  });

  it("calls pushEvent with restart-agent after confirming", async () => {
    const pushEvent = vi.fn();
    render(
      <AgentShow
        project={{ id: "p1", name: "test-project" }}
        agent={{ ...agent, status: "active" }}
        pushEvent={pushEvent}
      />,
    );
    await userEvent.click(screen.getByText("Restart Agent"));
    await userEvent.click(screen.getByText("Restart"));
    expect(pushEvent).toHaveBeenCalledWith("restart-agent", {});
  });

  it("calls pushEvent with delete-agent after confirming", async () => {
    const pushEvent = vi.fn();
    render(
      <AgentShow
        project={{ id: "p1", name: "test-project" }}
        agent={{ ...agent, status: "active" }}
        pushEvent={pushEvent}
      />,
    );
    await userEvent.click(screen.getByText("Delete Agent"));
    await userEvent.click(screen.getByText("Delete"));
    expect(pushEvent).toHaveBeenCalledWith("delete-agent", {});
  });

  it("shows Start and Delete buttons for crashed agent", () => {
    render(
      <AgentShow
        project={{ id: "p1", name: "test-project" }}
        agent={{ ...agent, status: "crashed" }}
        pushEvent={vi.fn()}
      />,
    );
    expect(screen.getByText("Start Agent")).toBeInTheDocument();
    expect(screen.getByText("Delete Agent")).toBeInTheDocument();
  });

  it("shows Restart and Delete buttons for bootstrapping agent", () => {
    render(
      <AgentShow
        project={{ id: "p1", name: "test-project" }}
        agent={{ ...agent, status: "bootstrapping" }}
        pushEvent={vi.fn()}
      />,
    );
    expect(screen.getByText("Restart Agent")).toBeInTheDocument();
    expect(screen.getByText("Delete Agent")).toBeInTheDocument();
    expect(screen.queryByText("Start Agent")).not.toBeInTheDocument();
  });

  it("shows Delete button for idle agent", () => {
    render(
      <AgentShow
        project={{ id: "p1", name: "test-project" }}
        agent={{ ...agent, status: "idle" }}
        pushEvent={vi.fn()}
      />,
    );
    expect(screen.getByText("Delete Agent")).toBeInTheDocument();
    expect(screen.getByText("Start Agent")).toBeInTheDocument();
  });

  it("calls pushEvent with delete-agent for created agent after confirming", async () => {
    const pushEvent = vi.fn();
    render(
      <AgentShow
        project={{ id: "p1", name: "test-project" }}
        agent={{ ...agent, status: "created" }}
        pushEvent={pushEvent}
      />,
    );
    await userEvent.click(screen.getByText("Delete Agent"));
    await userEvent.click(screen.getByText("Delete"));
    expect(pushEvent).toHaveBeenCalledWith("delete-agent", {});
  });

  it("displays harness badge", () => {
    render(<AgentShow project={{ id: "p1", name: "test-project" }} agent={agent} pushEvent={vi.fn()} />);
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("displays Pi harness", () => {
    render(
      <AgentShow
        project={{ id: "p1", name: "test-project" }}
        agent={{ ...agent, harness: "pi" }}
        pushEvent={vi.fn()}
      />,
    );
    expect(screen.getByText("Pi")).toBeInTheDocument();
  });

  it("shows Edit button and opens edit form dialog", async () => {
    render(<AgentShow project={{ id: "p1", name: "test-project" }} agent={agent} pushEvent={vi.fn()} />);
    const editBtn = screen.getByRole("button", { name: /edit/i });
    expect(editBtn).toBeInTheDocument();
    await userEvent.click(editBtn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Edit Agent")).toBeInTheDocument();
  });
});
