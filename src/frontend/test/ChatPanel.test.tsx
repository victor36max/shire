import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ChatPanel, { type Message } from "../components/ChatPanel";
import { type AgentOverview } from "../components/types";
import { renderWithProviders } from "./test-utils";

const activeAgent: AgentOverview = {
  id: "a1",
  name: "Test Agent",
  status: "active",
};

const createdAgent: AgentOverview = {
  ...activeAgent,
  status: "created",
};

const sendMutate = vi.fn();
const interruptMutate = vi.fn();
const restartMutate = vi.fn();
const loadMoreMutate = vi.fn();

let mockMessages: Array<Record<string, unknown>> = [];
let mockHasMore = false;

vi.mock("../lib/hooks", async () => {
  const actual = await vi.importActual("../lib/hooks");
  return {
    ...actual,
    useProjectId: () => ({ projectId: "p1", projectName: "test-project" }),
    useMessages: () => ({
      data: { messages: mockMessages, hasMore: mockHasMore },
      isLoading: false,
    }),
    useSendMessage: () => ({ mutate: sendMutate, isPending: false }),
    useInterruptAgent: () => ({ mutate: interruptMutate, isPending: false }),
    useRestartAgent: () => ({ mutate: restartMutate, isPending: false }),
    useLoadMoreMessages: () => ({ mutate: loadMoreMutate, isPending: false }),
  };
});

vi.mock("../lib/ws", () => ({
  useSubscription: vi.fn(),
}));

/** Helper to build API-format messages that transformMessages() in the component will process */
function apiMessage(msg: Message): Record<string, unknown> {
  return {
    id: msg.id,
    role: msg.role,
    createdAt: msg.ts,
    content: {
      text: msg.text,
      tool: msg.tool,
      tool_use_id: msg.tool_use_id,
      input: msg.input,
      output: msg.output,
      is_error: msg.is_error,
      from_agent: msg.from_agent,
      attachments: msg.attachments,
    },
  };
}

const messages: Message[] = [
  { id: 1, role: "user", text: "Hello agent", ts: "2026-03-17T00:00:00Z" },
  { id: 2, role: "agent", text: "Hello human", ts: "2026-03-17T00:00:01Z" },
];

describe("ChatPanel", () => {
  beforeEach(() => {
    mockMessages = [];
    mockHasMore = false;
    sendMutate.mockClear();
    interruptMutate.mockClear();
    restartMutate.mockClear();
    loadMoreMutate.mockClear();
  });

  it("renders empty state when no messages", () => {
    renderWithProviders(<ChatPanel agent={activeAgent} />);
    expect(screen.getByText(/Send a message to start working/)).toBeInTheDocument();
  });

  it("shows suggestion chips in empty state for active agent", async () => {
    renderWithProviders(<ChatPanel agent={activeAgent} />);
    const chip = screen.getByText("What can you help me with?");
    expect(chip).toBeInTheDocument();
    await userEvent.click(chip);
    expect(sendMutate).toHaveBeenCalledWith({ agentId: "a1", text: "What can you help me with?" });
  });

  it("renders messages", () => {
    mockMessages = messages.map(apiMessage);
    renderWithProviders(<ChatPanel agent={activeAgent} />);
    expect(screen.getByText("Hello agent")).toBeInTheDocument();
    expect(screen.getByText("Hello human")).toBeInTheDocument();
  });

  it("shows input bar when agent is active", () => {
    mockMessages = messages.map(apiMessage);
    renderWithProviders(<ChatPanel agent={activeAgent} />);
    expect(screen.getByPlaceholderText("Type a message...")).toBeInTheDocument();
    expect(screen.getByText("Send")).toBeInTheDocument();
  });

  it("hides input bar when agent is not active", () => {
    mockMessages = messages.map(apiMessage);
    renderWithProviders(<ChatPanel agent={createdAgent} />);
    expect(screen.queryByPlaceholderText("Type a message...")).not.toBeInTheDocument();
  });

  it("sends message on click", async () => {
    mockMessages = messages.map(apiMessage);
    renderWithProviders(<ChatPanel agent={activeAgent} />);

    fireEvent.change(screen.getByPlaceholderText("Type a message..."), {
      target: { value: "test message" },
    });
    await userEvent.click(screen.getByText("Send"));

    expect(sendMutate).toHaveBeenCalledWith({
      agentId: "a1",
      text: "test message",
      attachments: undefined,
    });
  });

  it("sends message on enter key", () => {
    mockMessages = messages.map(apiMessage);
    renderWithProviders(<ChatPanel agent={activeAgent} />);

    fireEvent.change(screen.getByPlaceholderText("Type a message..."), {
      target: { value: "test message" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Type a message..."), { key: "Enter" });

    expect(sendMutate).toHaveBeenCalledWith({
      agentId: "a1",
      text: "test message",
      attachments: undefined,
    });
  });

  it("does not send on shift+enter (allows newline)", () => {
    mockMessages = messages.map(apiMessage);
    renderWithProviders(<ChatPanel agent={activeAgent} />);

    fireEvent.change(screen.getByPlaceholderText("Type a message..."), {
      target: { value: "line one" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Type a message..."), {
      key: "Enter",
      shiftKey: true,
    });

    expect(sendMutate).not.toHaveBeenCalled();
  });

  it("does not send empty message", async () => {
    mockMessages = messages.map(apiMessage);
    renderWithProviders(<ChatPanel agent={activeAgent} />);

    await userEvent.click(screen.getByText("Send"));

    expect(sendMutate).not.toHaveBeenCalled();
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
    mockMessages = [apiMessage(toolMsg)];
    renderWithProviders(<ChatPanel agent={activeAgent} />);
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("sends load-more with before param when scrolled to top", () => {
    mockMessages = messages.map(apiMessage);
    mockHasMore = true;
    const { container } = renderWithProviders(<ChatPanel agent={activeAgent} />);

    const scrollContainer = container.querySelector(".overflow-y-auto")!;
    Object.defineProperty(scrollContainer, "scrollTop", { value: 0, writable: true });
    fireEvent.scroll(scrollContainer);

    expect(loadMoreMutate).toHaveBeenCalledWith({ agentId: "a1", before: 1 });
  });

  it("does not send load-more when no messages", () => {
    mockHasMore = true;
    const { container } = renderWithProviders(<ChatPanel agent={activeAgent} />);

    const scrollContainer = container.querySelector(".overflow-y-auto")!;
    Object.defineProperty(scrollContainer, "scrollTop", { value: 0, writable: true });
    fireEvent.scroll(scrollContainer);

    expect(loadMoreMutate).not.toHaveBeenCalled();
  });

  it("renders streaming text from props", () => {
    mockMessages = messages.map(apiMessage);
    const { rerender } = renderWithProviders(
      <ChatPanel agent={activeAgent} streamingText="Hello " />,
    );

    expect(screen.getByText("Hello")).toBeInTheDocument();

    rerender(<ChatPanel agent={activeAgent} streamingText="Hello world!" />);
    expect(screen.getByText("Hello world!")).toBeInTheDocument();

    rerender(<ChatPanel agent={activeAgent} streamingText="" />);
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
    mockMessages = [apiMessage(interAgentMsg)];
    renderWithProviders(<ChatPanel agent={activeAgent} />);
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
    mockMessages = [apiMessage(interAgentMsg)];
    renderWithProviders(<ChatPanel agent={activeAgent} />);
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
    mockMessages = [apiMessage(interAgentMsg)];
    renderWithProviders(<ChatPanel agent={activeAgent} />);
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
    mockMessages = [apiMessage(sysMsg)];
    renderWithProviders(<ChatPanel agent={activeAgent} />);
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
    mockMessages = [apiMessage(sysMsg)];
    renderWithProviders(<ChatPanel agent={activeAgent} />);
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
    mockMessages = [apiMessage(sysMsg)];
    renderWithProviders(<ChatPanel agent={activeAgent} />);
    const toggle = screen.getByText("System notification");
    await userEvent.click(toggle);
    expect(screen.getByText("Your outbox message was invalid")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByText("Your outbox message was invalid")).not.toBeInTheDocument();
  });

  it("shows stop button when isBusy is true", () => {
    mockMessages = messages.map(apiMessage);
    renderWithProviders(<ChatPanel agent={activeAgent} isBusy={true} />);
    expect(screen.getByLabelText("Stop")).toBeInTheDocument();
    expect(screen.queryByText("Send")).not.toBeInTheDocument();
  });

  it("sends interrupt event when stop button is clicked", async () => {
    mockMessages = messages.map(apiMessage);
    renderWithProviders(<ChatPanel agent={activeAgent} isBusy={true} />);
    await userEvent.click(screen.getByLabelText("Stop"));
    expect(interruptMutate).toHaveBeenCalledWith("a1");
  });

  it("shows send button when agent is not busy", () => {
    mockMessages = messages.map(apiMessage);
    renderWithProviders(<ChatPanel agent={activeAgent} />);
    expect(screen.getByText("Send")).toBeInTheDocument();
    expect(screen.queryByLabelText("Stop")).not.toBeInTheDocument();
  });

  it("shows thinking indicator when agent is busy and not streaming", () => {
    mockMessages = messages.map(apiMessage);
    renderWithProviders(<ChatPanel agent={activeAgent} isBusy={true} />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("hides thinking indicator when agent is busy but streaming", () => {
    mockMessages = messages.map(apiMessage);
    renderWithProviders(
      <ChatPanel agent={activeAgent} isBusy={true} streamingText="streaming..." />,
    );

    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
    expect(screen.getByText("streaming...")).toBeInTheDocument();
  });

  it("does not show thinking indicator when agent is not busy", () => {
    mockMessages = messages.map(apiMessage);
    renderWithProviders(<ChatPanel agent={activeAgent} />);
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  });

  it("shows idle message and restart button when agent is idle", () => {
    const idleAgent: AgentOverview = { ...activeAgent, status: "idle" };
    mockMessages = messages.map(apiMessage);
    renderWithProviders(<ChatPanel agent={idleAgent} />);
    expect(screen.getByText(/Agent is idle/)).toBeInTheDocument();
    expect(screen.getByText("Restart")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Type a message...")).not.toBeInTheDocument();
  });

  it("sends restart event when restart button is clicked", async () => {
    const idleAgent: AgentOverview = { ...activeAgent, status: "idle" };
    mockMessages = messages.map(apiMessage);
    renderWithProviders(<ChatPanel agent={idleAgent} />);
    await userEvent.click(screen.getByText("Restart"));
    expect(restartMutate).toHaveBeenCalledWith("a1");
  });

  it("shows attach button when agent is active", () => {
    mockMessages = messages.map(apiMessage);
    renderWithProviders(<ChatPanel agent={activeAgent} />);
    expect(screen.getByLabelText("Attach file")).toBeInTheDocument();
  });

  it("renders file attachment as download link", () => {
    const msgWithAtt: Message = {
      id: 30,
      role: "agent",
      text: "Here is your report",
      ts: "2026-03-17T00:00:05Z",
      attachments: [
        { id: "abc123", filename: "report.pdf", size: 1024, content_type: "application/pdf" },
      ],
    };
    mockMessages = [apiMessage(msgWithAtt)];
    renderWithProviders(<ChatPanel agent={activeAgent} />);
    const link = screen.getByText("report.pdf").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "/projects/test-project/agents/a1/attachments/abc123/report.pdf",
    );
  });

  it("renders image attachment as preview", () => {
    const msgWithImg: Message = {
      id: 31,
      role: "agent",
      text: "",
      ts: "2026-03-17T00:00:06Z",
      attachments: [
        { id: "img001", filename: "screenshot.png", size: 2048, content_type: "image/png" },
      ],
    };
    mockMessages = [apiMessage(msgWithImg)];
    renderWithProviders(<ChatPanel agent={activeAgent} />);
    const img = screen.getByAltText("screenshot.png");
    expect(img).toHaveAttribute(
      "src",
      "/projects/test-project/agents/a1/attachments/img001/screenshot.png",
    );
  });

  it("renders user message with attachments", () => {
    const userMsgWithAtt: Message = {
      id: 32,
      role: "user",
      text: "Check this file",
      ts: "2026-03-17T00:00:07Z",
      attachments: [{ id: "def456", filename: "data.csv", size: 512, content_type: "text/csv" }],
    };
    mockMessages = [apiMessage(userMsgWithAtt)];
    renderWithProviders(<ChatPanel agent={activeAgent} />);
    expect(screen.getByText("Check this file")).toBeInTheDocument();
    expect(screen.getByText("data.csv")).toBeInTheDocument();
  });
});
