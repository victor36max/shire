import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import ChatPanel, { type Message } from "../react-components/ChatPanel";
import { type Agent } from "../react-components/types";

const activeAgent: Agent = {
  id: "a1",
  name: "Test Agent",
  status: "active",
  model: "claude-sonnet-4-6",
  harness: "claude_code",
};

const createdAgent: Agent = {
  ...activeAgent,
  status: "created",
};

const messages: Message[] = [
  { id: 1, role: "user", text: "Hello agent", ts: "2026-03-17T00:00:00Z" },
  { id: 2, role: "agent", text: "Hello human", ts: "2026-03-17T00:00:01Z" },
];

describe("ChatPanel", () => {
  it("renders empty state when no messages", () => {
    render(<ChatPanel agent={activeAgent} messages={[]} pushEvent={vi.fn()} />);
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
  });

  it("renders messages", () => {
    render(<ChatPanel agent={activeAgent} messages={messages} pushEvent={vi.fn()} />);
    expect(screen.getByText("Hello agent")).toBeInTheDocument();
    expect(screen.getByText("Hello human")).toBeInTheDocument();
  });

  it("shows input bar when agent is active", () => {
    render(<ChatPanel agent={activeAgent} messages={messages} pushEvent={vi.fn()} />);
    expect(screen.getByPlaceholderText("Type a message...")).toBeInTheDocument();
    expect(screen.getByText("Send")).toBeInTheDocument();
  });

  it("hides input bar when agent is not active", () => {
    render(<ChatPanel agent={createdAgent} messages={messages} pushEvent={vi.fn()} />);
    expect(screen.queryByPlaceholderText("Type a message...")).not.toBeInTheDocument();
  });

  it("sends message on click", async () => {
    const pushEvent = vi.fn();
    render(<ChatPanel agent={activeAgent} messages={messages} pushEvent={pushEvent} />);

    fireEvent.change(screen.getByPlaceholderText("Type a message..."), { target: { value: "test message" } });
    await userEvent.click(screen.getByText("Send"));

    expect(pushEvent).toHaveBeenCalledWith("send-message", { text: "test message" });
  });

  it("sends message on enter key", async () => {
    const pushEvent = vi.fn();
    render(<ChatPanel agent={activeAgent} messages={messages} pushEvent={pushEvent} />);

    fireEvent.change(screen.getByPlaceholderText("Type a message..."), { target: { value: "test message" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Type a message..."), { key: "Enter" });

    expect(pushEvent).toHaveBeenCalledWith("send-message", { text: "test message" });
  });

  it("does not send on shift+enter (allows newline)", () => {
    const pushEvent = vi.fn();
    render(<ChatPanel agent={activeAgent} messages={messages} pushEvent={pushEvent} />);

    fireEvent.change(screen.getByPlaceholderText("Type a message..."), { target: { value: "line one" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Type a message..."), { key: "Enter", shiftKey: true });

    expect(pushEvent).not.toHaveBeenCalled();
  });

  it("does not send empty message", async () => {
    const pushEvent = vi.fn();
    render(<ChatPanel agent={activeAgent} messages={messages} pushEvent={pushEvent} />);

    await userEvent.click(screen.getByText("Send"));

    expect(pushEvent).not.toHaveBeenCalled();
  });

  it("renders tool call messages", () => {
    const toolMsg: Message = {
      id: 3,
      role: "tool_use",
      tool: "read_file",
      tool_use_id: "tu_1",
      input: { path: "/test.txt" },
      output: "file contents",
      is_error: false,
      ts: "2026-03-17T00:00:02Z",
    };
    render(<ChatPanel agent={activeAgent} messages={[toolMsg]} pushEvent={vi.fn()} />);
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("shows loading indicator when loadingMore", () => {
    render(<ChatPanel agent={activeAgent} messages={messages} hasMore loadingMore pushEvent={vi.fn()} />);
    expect(screen.getByText("Loading older messages...")).toBeInTheDocument();
  });

  it("renders streaming messages", () => {
    const streamingMessages: Message[] = [
      ...messages,
      { role: "agent_streaming", text: "thinking...", ts: "2026-03-17T00:00:02Z" },
    ];
    render(<ChatPanel agent={activeAgent} messages={streamingMessages} pushEvent={vi.fn()} />);
    expect(screen.getByText("thinking...")).toBeInTheDocument();
  });

  it("renders inter-agent message collapsed by default", () => {
    const interAgentMsg: Message = {
      id: 10,
      role: "inter_agent",
      text: "Here is the analysis result",
      from_agent: "researcher",
      ts: "2026-03-17T00:00:03Z",
    };
    render(<ChatPanel agent={activeAgent} messages={[interAgentMsg]} pushEvent={vi.fn()} />);
    expect(screen.getByText("Message from researcher")).toBeInTheDocument();
    expect(screen.queryByText("Here is the analysis result")).not.toBeInTheDocument();
  });

  it("expands inter-agent message on click", async () => {
    const interAgentMsg: Message = {
      id: 10,
      role: "inter_agent",
      text: "Here is the analysis result",
      from_agent: "researcher",
      ts: "2026-03-17T00:00:03Z",
    };
    render(<ChatPanel agent={activeAgent} messages={[interAgentMsg]} pushEvent={vi.fn()} />);
    await userEvent.click(screen.getByText("Message from researcher"));
    expect(screen.getByText("Here is the analysis result")).toBeInTheDocument();
  });

  it("collapses inter-agent message on second click", async () => {
    const interAgentMsg: Message = {
      id: 10,
      role: "inter_agent",
      text: "Here is the analysis result",
      from_agent: "researcher",
      ts: "2026-03-17T00:00:03Z",
    };
    render(<ChatPanel agent={activeAgent} messages={[interAgentMsg]} pushEvent={vi.fn()} />);
    const toggle = screen.getByText("Message from researcher");
    await userEvent.click(toggle);
    expect(screen.getByText("Here is the analysis result")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByText("Here is the analysis result")).not.toBeInTheDocument();
  });

  it("renders system message collapsed by default", () => {
    const sysMsg: Message = {
      id: 20,
      role: "system",
      text: "Your outbox message was invalid",
      ts: "2026-03-17T00:00:04Z",
    };
    render(<ChatPanel agent={activeAgent} messages={[sysMsg]} pushEvent={vi.fn()} />);
    expect(screen.getByText("System notification")).toBeInTheDocument();
    expect(screen.queryByText("Your outbox message was invalid")).not.toBeInTheDocument();
  });

  it("expands system message on click", async () => {
    const sysMsg: Message = {
      id: 20,
      role: "system",
      text: "Your outbox message was invalid",
      ts: "2026-03-17T00:00:04Z",
    };
    render(<ChatPanel agent={activeAgent} messages={[sysMsg]} pushEvent={vi.fn()} />);
    await userEvent.click(screen.getByText("System notification"));
    expect(screen.getByText("Your outbox message was invalid")).toBeInTheDocument();
  });

  it("collapses system message on second click", async () => {
    const sysMsg: Message = {
      id: 20,
      role: "system",
      text: "Your outbox message was invalid",
      ts: "2026-03-17T00:00:04Z",
    };
    render(<ChatPanel agent={activeAgent} messages={[sysMsg]} pushEvent={vi.fn()} />);
    const toggle = screen.getByText("System notification");
    await userEvent.click(toggle);
    expect(screen.getByText("Your outbox message was invalid")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByText("Your outbox message was invalid")).not.toBeInTheDocument();
  });

  it("shows thinking indicator when agent is busy", () => {
    const busyAgent = { ...activeAgent, busy: true };
    render(<ChatPanel agent={busyAgent} messages={messages} pushEvent={vi.fn()} />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("does not show thinking indicator when agent is not busy", () => {
    render(<ChatPanel agent={activeAgent} messages={messages} pushEvent={vi.fn()} />);
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  });
});
