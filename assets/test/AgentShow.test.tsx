import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { type Agent } from "../react-components/types";

// Mock Terminal component to avoid xterm/canvas dependencies
vi.mock("../react-components/Terminal", () => ({
  default: ({ pushEvent }: { pushEvent: unknown }) => (
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
  harness: "pi",
  recipe: "version: 1\nname: Test Agent\nharness: pi\nmodel: claude-sonnet-4-6\nsystem_prompt: You are a helpful assistant.",
  is_base: false,
};

describe("AgentShow", () => {
  it("renders agent details", () => {
    render(<AgentShow agent={agent} pushEvent={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Test Agent" })).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
    expect(screen.getByText("You are a helpful assistant.")).toBeInTheDocument();
    expect(screen.getAllByText("active")).toHaveLength(2); // header badge + detail badge
  });

  it("shows fallback for missing model and system prompt", () => {
    render(<AgentShow agent={{ ...agent, model: null, system_prompt: null }} pushEvent={vi.fn()} />);
    expect(screen.getAllByText("Not set")).toHaveLength(2);
  });

  it("calls pushEvent with edit on Edit click", async () => {
    const pushEvent = vi.fn();
    render(<AgentShow agent={agent} pushEvent={pushEvent} />);
    await userEvent.click(screen.getByText("Edit"));
    expect(pushEvent).toHaveBeenCalledWith("edit", { id: 1 });
  });

  it("shows Start button for created agent", () => {
    render(<AgentShow agent={{ ...agent, status: "created" }} pushEvent={vi.fn()} />);
    expect(screen.getByText("Start Agent")).toBeInTheDocument();
  });

  it("shows Stop button for active agent", () => {
    render(<AgentShow agent={{ ...agent, status: "active" }} pushEvent={vi.fn()} />);
    expect(screen.getByText("Stop Agent")).toBeInTheDocument();
  });

  it("calls pushEvent with start-agent", async () => {
    const pushEvent = vi.fn();
    render(<AgentShow agent={{ ...agent, status: "created" }} pushEvent={pushEvent} />);
    await userEvent.click(screen.getByText("Start Agent"));
    expect(pushEvent).toHaveBeenCalledWith("start-agent", {});
  });

  it("calls pushEvent with stop-agent", async () => {
    const pushEvent = vi.fn();
    render(<AgentShow agent={{ ...agent, status: "active" }} pushEvent={pushEvent} />);
    await userEvent.click(screen.getByText("Stop Agent"));
    expect(pushEvent).toHaveBeenCalledWith("stop-agent", {});
  });

  it("displays harness badge", () => {
    render(<AgentShow agent={agent} pushEvent={vi.fn()} />);
    expect(screen.getByText("Pi")).toBeInTheDocument();
  });

  it("displays Claude Code harness", () => {
    render(<AgentShow agent={{ ...agent, harness: "claude_code" }} pushEvent={vi.fn()} />);
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("renders scripts section when scripts present", () => {
    const withScripts = { ...agent, scripts: [{ name: "setup", run: "apt-get update" }] };
    render(<AgentShow agent={withScripts} pushEvent={vi.fn()} />);
    expect(screen.getByText("Scripts")).toBeInTheDocument();
    expect(screen.getByText("setup")).toBeInTheDocument();
    expect(screen.getByText("apt-get update")).toBeInTheDocument();
  });

  it("renders tool call messages with running state", () => {
    const messages = [
      {
        role: "tool_use",
        tool: "Bash",
        tool_use_id: "tu_1",
        input: { command: "ls" },
        output: null,
        is_error: false,
        ts: "2026-03-16T00:00:00Z",
      },
    ];
    render(<AgentShow agent={agent} messages={messages} pushEvent={vi.fn()} />);
    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("running...")).toBeInTheDocument();
  });

  it("renders tool call messages with done state", () => {
    const messages = [
      {
        role: "tool_use",
        tool: "Read",
        tool_use_id: "tu_2",
        input: { file_path: "/tmp/test.txt" },
        output: "file contents here",
        is_error: false,
        ts: "2026-03-16T00:00:00Z",
      },
    ];
    render(<AgentShow agent={agent} messages={messages} pushEvent={vi.fn()} />);
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("renders tool call messages with error state", () => {
    const messages = [
      {
        role: "tool_use",
        tool: "Write",
        tool_use_id: "tu_3",
        input: { file_path: "/readonly" },
        output: "permission denied",
        is_error: true,
        ts: "2026-03-16T00:00:00Z",
      },
    ];
    render(<AgentShow agent={agent} messages={messages} pushEvent={vi.fn()} />);
    expect(screen.getByText("Write")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("expands tool call to show input and output", async () => {
    const messages = [
      {
        role: "tool_use",
        tool: "Bash",
        tool_use_id: "tu_4",
        input: { command: "echo hello" },
        output: "hello",
        is_error: false,
        ts: "2026-03-16T00:00:00Z",
      },
    ];
    render(<AgentShow agent={agent} messages={messages} pushEvent={vi.fn()} />);
    expect(screen.queryByText("Input")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("Input")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("shows chat history for stopped agents", () => {
    const messages = [
      { id: 1, role: "user", text: "hello", ts: "2026-03-16T00:00:00Z" },
      { id: 2, role: "agent", text: "hi there", ts: "2026-03-16T00:00:01Z" },
    ];
    render(<AgentShow agent={{ ...agent, status: "created" }} messages={messages} pushEvent={vi.fn()} />);
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("hi there")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Type a message...")).not.toBeInTheDocument();
  });

  it("shows loading indicator when loadingMore is true", () => {
    const messages = [{ id: 1, role: "user", text: "hello", ts: "2026-03-16T00:00:00Z" }];
    render(
      <AgentShow agent={agent} messages={messages} hasMore={true} loadingMore={true} pushEvent={vi.fn()} />,
    );
    expect(screen.getByText("Loading older messages...")).toBeInTheDocument();
  });

  it("shows Terminal tab for active agents", () => {
    render(<AgentShow agent={{ ...agent, status: "active" }} pushEvent={vi.fn()} />);
    expect(screen.getByText("Terminal")).toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("does not show Terminal tab for created agents", () => {
    const messages = [{ id: 1, role: "user", text: "hello", ts: "2026-03-16T00:00:00Z" }];
    render(<AgentShow agent={{ ...agent, status: "created" }} messages={messages} pushEvent={vi.fn()} />);
    expect(screen.queryByText("Terminal")).not.toBeInTheDocument();
  });

  it("switches to terminal view when Terminal tab is clicked", async () => {
    render(<AgentShow agent={{ ...agent, status: "active" }} pushEvent={vi.fn()} />);
    await userEvent.click(screen.getByText("Terminal"));
    expect(screen.getByTestId("terminal-mock")).toBeInTheDocument();
  });

  it("shows Terminal tab for sleeping agents", () => {
    const messages = [{ id: 1, role: "user", text: "hello", ts: "2026-03-16T00:00:00Z" }];
    render(<AgentShow agent={{ ...agent, status: "sleeping" }} messages={messages} pushEvent={vi.fn()} />);
    expect(screen.getByText("Terminal")).toBeInTheDocument();
  });
});
