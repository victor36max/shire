import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { useLiveReact } from "live_react";
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
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={[]} pushEvent={vi.fn()} />);
    expect(screen.getByText(/Send a message to start working/)).toBeInTheDocument();
  });

  it("shows suggestion chips in empty state for active agent", async () => {
    const pushEvent = vi.fn();
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={[]} pushEvent={pushEvent} />);
    const chip = screen.getByText("What can you help me with?");
    expect(chip).toBeInTheDocument();
    await userEvent.click(chip);
    expect(pushEvent).toHaveBeenCalledWith("send-message", { text: "What can you help me with?" });
  });

  it("shows agent description in empty state when available", () => {
    const agentWithDesc = { ...activeAgent, description: "I help write tests." };
    render(<ChatPanel agent={agentWithDesc} projectName="test-project" messages={[]} pushEvent={vi.fn()} />);
    expect(screen.getByText("I help write tests.")).toBeInTheDocument();
  });

  it("renders messages", () => {
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={messages} pushEvent={vi.fn()} />);
    expect(screen.getByText("Hello agent")).toBeInTheDocument();
    expect(screen.getByText("Hello human")).toBeInTheDocument();
  });

  it("shows input bar when agent is active", () => {
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={messages} pushEvent={vi.fn()} />);
    expect(screen.getByPlaceholderText("Type a message...")).toBeInTheDocument();
    expect(screen.getByText("Send")).toBeInTheDocument();
  });

  it("hides input bar when agent is not active", () => {
    render(<ChatPanel agent={createdAgent} messages={messages} pushEvent={vi.fn()} />);
    expect(screen.queryByPlaceholderText("Type a message...")).not.toBeInTheDocument();
  });

  it("sends message on click", async () => {
    const pushEvent = vi.fn();
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={messages} pushEvent={pushEvent} />);

    fireEvent.change(screen.getByPlaceholderText("Type a message..."), { target: { value: "test message" } });
    await userEvent.click(screen.getByText("Send"));

    expect(pushEvent).toHaveBeenCalledWith("send-message", { text: "test message" });
  });

  it("sends message on enter key", async () => {
    const pushEvent = vi.fn();
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={messages} pushEvent={pushEvent} />);

    fireEvent.change(screen.getByPlaceholderText("Type a message..."), { target: { value: "test message" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Type a message..."), { key: "Enter" });

    expect(pushEvent).toHaveBeenCalledWith("send-message", { text: "test message" });
  });

  it("does not send on shift+enter (allows newline)", () => {
    const pushEvent = vi.fn();
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={messages} pushEvent={pushEvent} />);

    fireEvent.change(screen.getByPlaceholderText("Type a message..."), { target: { value: "line one" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Type a message..."), { key: "Enter", shiftKey: true });

    expect(pushEvent).not.toHaveBeenCalled();
  });

  it("does not send empty message", async () => {
    const pushEvent = vi.fn();
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={messages} pushEvent={pushEvent} />);

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
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={[toolMsg]} pushEvent={vi.fn()} />);
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("sends load-more with before param when scrolled to top", () => {
    const pushEvent = vi.fn();
    const { container } = render(
      <ChatPanel agent={activeAgent} projectName="test-project" messages={messages} hasMore pushEvent={pushEvent} />,
    );

    const scrollContainer = container.querySelector(".overflow-y-auto")!;
    Object.defineProperty(scrollContainer, "scrollTop", { value: 0, writable: true });
    fireEvent.scroll(scrollContainer);

    expect(pushEvent).toHaveBeenCalledWith("load-more", { before: 1 });
  });

  it("does not send load-more when no messages", () => {
    const pushEvent = vi.fn();
    const { container } = render(
      <ChatPanel agent={activeAgent} projectName="test-project" messages={[]} hasMore pushEvent={pushEvent} />,
    );

    const scrollContainer = container.querySelector(".overflow-y-auto")!;
    Object.defineProperty(scrollContainer, "scrollTop", { value: 0, writable: true });
    fireEvent.scroll(scrollContainer);

    expect(pushEvent).not.toHaveBeenCalled();
  });

  it("shows loading indicator when loadingMore", () => {
    render(
      <ChatPanel
        agent={activeAgent}
        projectName="test-project"
        messages={messages}
        hasMore
        loadingMore
        pushEvent={vi.fn()}
      />,
    );
    expect(screen.getByText("Loading older messages...")).toBeInTheDocument();
  });

  it("renders streaming text from push_event deltas", () => {
    const handlers: Record<string, (payload: Record<string, unknown>) => void> = {};
    vi.mocked(useLiveReact).mockReturnValue({
      handleEvent: vi.fn((event: string, callback: (payload: Record<string, unknown>) => void) => {
        handlers[event] = callback;
        return `ref-${event}`;
      }),
      removeHandleEvent: vi.fn(),
      pushEvent: vi.fn(),
      pushEventTo: vi.fn(),
      upload: vi.fn(),
      uploadTo: vi.fn(),
    });

    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={messages} pushEvent={vi.fn()} />);

    // Simulate text_delta events
    act(() => {
      handlers["text_delta"]({ delta: "Hello " });
    });
    expect(screen.getByText("Hello")).toBeInTheDocument();

    act(() => {
      handlers["text_delta"]({ delta: "world!" });
    });
    expect(screen.getByText("Hello world!")).toBeInTheDocument();

    // Simulate flush — streaming text should clear
    act(() => {
      handlers["streaming_flush"]({});
    });
    expect(screen.queryByText("Hello world!")).not.toBeInTheDocument();
  });

  it("renders inter-agent message collapsed by default", () => {
    const interAgentMsg: Message = {
      id: 10,
      role: "inter_agent",
      text: "Here is the analysis result",
      from_agent: "researcher",
      ts: "2026-03-17T00:00:03Z",
    };
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={[interAgentMsg]} pushEvent={vi.fn()} />);
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
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={[interAgentMsg]} pushEvent={vi.fn()} />);
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
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={[interAgentMsg]} pushEvent={vi.fn()} />);
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
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={[sysMsg]} pushEvent={vi.fn()} />);
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
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={[sysMsg]} pushEvent={vi.fn()} />);
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
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={[sysMsg]} pushEvent={vi.fn()} />);
    const toggle = screen.getByText("System notification");
    await userEvent.click(toggle);
    expect(screen.getByText("Your outbox message was invalid")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByText("Your outbox message was invalid")).not.toBeInTheDocument();
  });

  it("shows stop button when agent is busy", () => {
    const busyAgent = { ...activeAgent, busy: true };
    render(<ChatPanel agent={busyAgent} projectName="test-project" messages={messages} pushEvent={vi.fn()} />);
    expect(screen.getByLabelText("Stop")).toBeInTheDocument();
    expect(screen.queryByText("Send")).not.toBeInTheDocument();
  });

  it("sends interrupt-agent event when stop button is clicked", async () => {
    const busyAgent = { ...activeAgent, busy: true };
    const pushEvent = vi.fn();
    render(<ChatPanel agent={busyAgent} projectName="test-project" messages={messages} pushEvent={pushEvent} />);
    await userEvent.click(screen.getByLabelText("Stop"));
    expect(pushEvent).toHaveBeenCalledWith("interrupt-agent", {});
  });

  it("shows send button when agent is not busy", () => {
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={messages} pushEvent={vi.fn()} />);
    expect(screen.getByText("Send")).toBeInTheDocument();
    expect(screen.queryByLabelText("Stop")).not.toBeInTheDocument();
  });

  it("shows thinking indicator when agent is busy and not streaming", () => {
    const busyAgent = { ...activeAgent, busy: true };
    render(<ChatPanel agent={busyAgent} projectName="test-project" messages={messages} pushEvent={vi.fn()} />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("hides thinking indicator when agent is busy but streaming", () => {
    const handlers: Record<string, (payload: Record<string, unknown>) => void> = {};
    vi.mocked(useLiveReact).mockReturnValue({
      handleEvent: vi.fn((event: string, callback: (payload: Record<string, unknown>) => void) => {
        handlers[event] = callback;
        return `ref-${event}`;
      }),
      removeHandleEvent: vi.fn(),
      pushEvent: vi.fn(),
      pushEventTo: vi.fn(),
      upload: vi.fn(),
      uploadTo: vi.fn(),
    });

    const busyAgent = { ...activeAgent, busy: true };
    render(<ChatPanel agent={busyAgent} projectName="test-project" messages={messages} pushEvent={vi.fn()} />);

    act(() => {
      handlers["text_delta"]({ delta: "streaming..." });
    });
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
    expect(screen.getByText("streaming...")).toBeInTheDocument();
  });

  it("does not show thinking indicator when agent is not busy", () => {
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={messages} pushEvent={vi.fn()} />);
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  });

  it("shows idle message and restart button when agent is idle", () => {
    const idleAgent: Agent = { ...activeAgent, status: "idle" };
    const pushEvent = vi.fn();
    render(<ChatPanel agent={idleAgent} projectName="test-project" messages={messages} pushEvent={pushEvent} />);
    expect(screen.getByText(/Agent is idle/)).toBeInTheDocument();
    expect(screen.getByText("Restart")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Type a message...")).not.toBeInTheDocument();
  });

  it("sends restart-agent event when restart button is clicked", async () => {
    const idleAgent: Agent = { ...activeAgent, status: "idle" };
    const pushEvent = vi.fn();
    render(<ChatPanel agent={idleAgent} projectName="test-project" messages={messages} pushEvent={pushEvent} />);
    await userEvent.click(screen.getByText("Restart"));
    expect(pushEvent).toHaveBeenCalledWith("restart-agent", {});
  });

  it("shows attach button when agent is active", () => {
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={messages} pushEvent={vi.fn()} />);
    expect(screen.getByLabelText("Attach file")).toBeInTheDocument();
  });

  it("renders file attachment as download link", () => {
    const msgWithAtt: Message = {
      id: 30,
      role: "agent",
      text: "Here is your report",
      ts: "2026-03-17T00:00:05Z",
      attachments: [{ id: "abc123", filename: "report.pdf", size: 1024, content_type: "application/pdf" }],
    };
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={[msgWithAtt]} pushEvent={vi.fn()} />);
    const link = screen.getByText("report.pdf").closest("a");
    expect(link).toHaveAttribute("href", "/projects/test-project/agents/a1/attachments/abc123/report.pdf");
  });

  it("renders image attachment as preview", () => {
    const msgWithImg: Message = {
      id: 31,
      role: "agent",
      text: "",
      ts: "2026-03-17T00:00:06Z",
      attachments: [{ id: "img001", filename: "screenshot.png", size: 2048, content_type: "image/png" }],
    };
    render(<ChatPanel agent={activeAgent} projectName="test-project" messages={[msgWithImg]} pushEvent={vi.fn()} />);
    const img = screen.getByAltText("screenshot.png");
    expect(img).toHaveAttribute("src", "/projects/test-project/agents/a1/attachments/img001/screenshot.png");
  });

  it("renders user message with attachments", () => {
    const userMsgWithAtt: Message = {
      id: 32,
      role: "user",
      text: "Check this file",
      ts: "2026-03-17T00:00:07Z",
      attachments: [{ id: "def456", filename: "data.csv", size: 512, content_type: "text/csv" }],
    };
    render(
      <ChatPanel agent={activeAgent} projectName="test-project" messages={[userMsgWithAtt]} pushEvent={vi.fn()} />,
    );
    expect(screen.getByText("Check this file")).toBeInTheDocument();
    expect(screen.getByText("data.csv")).toBeInTheDocument();
  });
});
