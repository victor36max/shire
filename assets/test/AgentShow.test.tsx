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
  id: 1,
  name: "Test Agent",
  status: "active",
  model: "claude-sonnet-4-6",
  system_prompt: "You are a helpful assistant.",
  harness: "claude_code",
  recipe:
    "version: 1\nname: Test Agent\nharness: claude_code\nmodel: claude-sonnet-4-6\nsystem_prompt: You are a helpful assistant.",
  is_base: false,
};

describe("AgentShow", () => {
  it("renders agent details", () => {
    render(<AgentShow agent={agent} secrets={[]} pushEvent={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Test Agent" })).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
    expect(screen.getByText("You are a helpful assistant.")).toBeInTheDocument();
    expect(screen.getAllByText("active")).toHaveLength(2); // header badge + detail badge
  });

  it("shows fallback for missing model and system prompt", () => {
    render(<AgentShow agent={{ ...agent, model: null, system_prompt: null }} secrets={[]} pushEvent={vi.fn()} />);
    expect(screen.getAllByText("Not set")).toHaveLength(2);
  });

  it("shows Start button for created agent", () => {
    render(<AgentShow agent={{ ...agent, status: "created" }} secrets={[]} pushEvent={vi.fn()} />);
    expect(screen.getByText("Start Agent")).toBeInTheDocument();
  });

  it("shows Restart and Kill buttons for active agent", () => {
    render(<AgentShow agent={{ ...agent, status: "active" }} secrets={[]} pushEvent={vi.fn()} />);
    expect(screen.getByText("Restart Agent")).toBeInTheDocument();
    expect(screen.getByText("Kill Agent")).toBeInTheDocument();
  });

  it("calls pushEvent with start-agent", async () => {
    const pushEvent = vi.fn();
    render(<AgentShow agent={{ ...agent, status: "created" }} secrets={[]} pushEvent={pushEvent} />);
    await userEvent.click(screen.getByText("Start Agent"));
    expect(pushEvent).toHaveBeenCalledWith("start-agent", {});
  });

  it("calls pushEvent with restart-agent after confirming", async () => {
    const pushEvent = vi.fn();
    render(<AgentShow agent={{ ...agent, status: "active" }} secrets={[]} pushEvent={pushEvent} />);
    await userEvent.click(screen.getByText("Restart Agent"));
    await userEvent.click(screen.getByText("Restart"));
    expect(pushEvent).toHaveBeenCalledWith("restart-agent", {});
  });

  it("calls pushEvent with kill-agent after confirming", async () => {
    const pushEvent = vi.fn();
    render(<AgentShow agent={{ ...agent, status: "active" }} secrets={[]} pushEvent={pushEvent} />);
    await userEvent.click(screen.getByText("Kill Agent"));
    await userEvent.click(screen.getByText("Kill"));
    expect(pushEvent).toHaveBeenCalledWith("kill-agent", {});
  });

  it("shows Start button for crashed agent", () => {
    render(<AgentShow agent={{ ...agent, status: "crashed" }} secrets={[]} pushEvent={vi.fn()} />);
    expect(screen.getByText("Start Agent")).toBeInTheDocument();
  });

  it("displays harness badge", () => {
    render(<AgentShow agent={agent} secrets={[]} pushEvent={vi.fn()} />);
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("displays Pi harness", () => {
    render(<AgentShow agent={{ ...agent, harness: "pi" }} secrets={[]} pushEvent={vi.fn()} />);
    expect(screen.getByText("Pi")).toBeInTheDocument();
  });

  it("renders scripts section when scripts present", () => {
    const withScripts = { ...agent, scripts: [{ name: "setup", run: "apt-get update" }] };
    render(<AgentShow agent={withScripts} secrets={[]} pushEvent={vi.fn()} />);
    expect(screen.getByText("Scripts")).toBeInTheDocument();
    expect(screen.getByText("setup")).toBeInTheDocument();
    expect(screen.getByText("apt-get update")).toBeInTheDocument();
  });

  it("shows Terminal section for active agents", () => {
    render(<AgentShow agent={{ ...agent, status: "active" }} secrets={[]} pushEvent={vi.fn()} />);
    expect(screen.getByText("Terminal")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-mock")).toBeInTheDocument();
  });

  it("does not show Terminal content for created agents", () => {
    render(<AgentShow agent={{ ...agent, status: "created" }} secrets={[]} pushEvent={vi.fn()} />);
    expect(screen.queryByTestId("terminal-mock")).not.toBeInTheDocument();
  });

  it("shows Terminal section for sleeping agents", () => {
    render(<AgentShow agent={{ ...agent, status: "sleeping" }} secrets={[]} pushEvent={vi.fn()} />);
    expect(screen.getByText("Terminal")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-mock")).toBeInTheDocument();
  });

  it("shows Environment tab with secrets", async () => {
    const secrets = [{ id: 1, key: "MY_VAR" }];
    render(<AgentShow agent={agent} secrets={secrets} pushEvent={vi.fn()} />);
    await userEvent.click(screen.getByText("Environment"));
    expect(screen.getByText("MY_VAR")).toBeInTheDocument();
  });

  it("defaults to Environment tab when agent is not active", () => {
    render(<AgentShow agent={{ ...agent, status: "created" }} secrets={[]} pushEvent={vi.fn()} />);
    // Environment tab should be default since terminal is not available
    expect(screen.getByText(/Environment variables specific to this agent/)).toBeInTheDocument();
  });

  it("shows Edit button and opens edit form dialog", async () => {
    render(<AgentShow agent={agent} secrets={[]} pushEvent={vi.fn()} />);
    const editBtn = screen.getByRole("button", { name: /edit/i });
    expect(editBtn).toBeInTheDocument();
    await userEvent.click(editBtn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Edit Agent")).toBeInTheDocument();
  });

  it("calls pushEvent with create-agent-secret on env var creation", async () => {
    const pushEvent = vi.fn();
    render(<AgentShow agent={{ ...agent, status: "created" }} secrets={[]} pushEvent={pushEvent} />);
    await userEvent.click(screen.getByText("New Secret"));
    await userEvent.type(screen.getByLabelText("Key"), "MY_KEY");
    await userEvent.type(screen.getByLabelText("Value"), "my-value");
    await userEvent.click(screen.getByText("Save Secret"));
    expect(pushEvent).toHaveBeenCalledWith("create-agent-secret", {
      secret: { key: "MY_KEY", value: "my-value" },
    });
  });
});
