import { screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import ChatPanel, { type Message } from "../components/ChatPanel";
import { type AgentOverview } from "../components/types";
import { renderWithProviders, waitForText } from "./test-utils";

mock.module("../lib/ws", () => ({
  useSubscription: mock(() => {}),
}));

const activeAgent: AgentOverview = {
  id: "a1",
  name: "Test Agent",
  status: "active",
  busy: false,
  unreadCount: 0,
};

const createdAgent: AgentOverview = {
  ...activeAgent,
  status: "created",
};

const routeOpts = {
  route: "/projects/test-project",
  routePath: "/projects/:projectName",
};

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
      isError: msg.isError,
      fromAgent: msg.fromAgent,
      attachments: msg.attachments,
    },
  };
}

const messages: Message[] = [
  { id: 1, role: "user", text: "Hello agent", ts: "2026-03-17T00:00:00Z" },
  { id: 2, role: "agent", text: "Hello human", ts: "2026-03-17T00:00:01Z" },
];

function setMessages(msgs: Message[], hasMore = false) {
  server.use(
    http.get("*/api/projects/:id/agents/:aid/messages", () =>
      HttpResponse.json({ messages: msgs.map(apiMessage), hasMore }),
    ),
  );
}

function createFile(name: string, size: number, type = "text/plain"): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type });
}

function createDataTransfer(files: File[]): DataTransfer {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  return dt;
}

describe("ChatPanel", () => {
  it("renders empty state when no messages", async () => {
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText(/Send a message to start working/)).toBeInTheDocument();
    });
  });

  it("shows suggestion chips in empty state for active agent", async () => {
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitForText("What can you help me with?");
    await userEvent.click(screen.getByText("What can you help me with?"));
    // After clicking, the chip triggers a message send — component should react
    // (the default POST handler returns { ok: true })
  });

  it("renders messages", async () => {
    setMessages(messages);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Hello agent")).toBeInTheDocument();
    });
    expect(screen.getByText("Hello human")).toBeInTheDocument();
  });

  it("shows input bar when agent is active", async () => {
    setMessages(messages);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Type a message...")).toBeInTheDocument();
    });
    expect(screen.getByText("Send")).toBeInTheDocument();
  });

  it("hides input bar when agent is not active", async () => {
    setMessages(messages);
    renderWithProviders(<ChatPanel agent={createdAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Hello agent")).toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText("Type a message...")).not.toBeInTheDocument();
  });

  it("sends message on click", async () => {
    let sentPayload: Record<string, unknown> | undefined;
    server.use(
      http.post("*/api/projects/:id/agents/:aid/message", async ({ request }) => {
        sentPayload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, message: null });
      }),
    );
    setMessages(messages);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Type a message...")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Type a message..."), {
      target: { value: "test message" },
    });
    await userEvent.click(screen.getByText("Send"));

    await waitFor(() => {
      expect(sentPayload).toBeDefined();
      expect(sentPayload!.text).toBe("test message");
    });
  });

  it("sends message on enter key", async () => {
    let sentPayload: Record<string, unknown> | undefined;
    server.use(
      http.post("*/api/projects/:id/agents/:aid/message", async ({ request }) => {
        sentPayload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, message: null });
      }),
    );
    setMessages(messages);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Type a message...")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Type a message..."), {
      target: { value: "test message" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Type a message..."), { key: "Enter" });

    await waitFor(() => {
      expect(sentPayload).toBeDefined();
      expect(sentPayload!.text).toBe("test message");
    });
  });

  it("does not send on shift+enter (allows newline)", async () => {
    let sendCalled = false;
    server.use(
      http.post("*/api/projects/:id/agents/:aid/message", () => {
        sendCalled = true;
        return HttpResponse.json({ ok: true, message: null });
      }),
    );
    setMessages(messages);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Type a message...")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Type a message..."), {
      target: { value: "line one" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Type a message..."), {
      key: "Enter",
      shiftKey: true,
    });

    // Give a small window for any potential call
    await new Promise((r) => setTimeout(r, 50));
    expect(sendCalled).toBe(false);
  });

  it("does not send empty message", async () => {
    let sendCalled = false;
    server.use(
      http.post("*/api/projects/:id/agents/:aid/message", () => {
        sendCalled = true;
        return HttpResponse.json({ ok: true, message: null });
      }),
    );
    setMessages(messages);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("Send")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Send"));

    await new Promise((r) => setTimeout(r, 50));
    expect(sendCalled).toBe(false);
  });

  it("renders tool call messages", async () => {
    const toolMsg: Message = {
      id: 3,
      role: "tool_use",
      tool: "read_file",
      tool_use_id: "tu_1",
      input: { path: "/test.txt" },
      output: "file contents",
      isError: false,
      ts: "2026-03-17T00:00:02Z",
    };
    setMessages([toolMsg]);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("read_file")).toBeInTheDocument();
    });
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("fetches next page when sentinel becomes visible", async () => {
    let fetchCount = 0;
    // Capture IntersectionObserver callback
    let observerCallback: IntersectionObserverCallback | null = null;
    const origIO = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class MockIO {
      constructor(cb: IntersectionObserverCallback) {
        observerCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;

    server.use(
      http.get("*/api/projects/:id/agents/:aid/messages", ({ request }) => {
        fetchCount++;
        const url = new URL(request.url);
        const before = url.searchParams.get("before");
        if (before) {
          return HttpResponse.json({ messages: [], hasMore: false });
        }
        return HttpResponse.json({
          messages: messages.map(apiMessage),
          hasMore: true,
        });
      }),
    );
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("Hello agent")).toBeInTheDocument();
    });

    const initialCount = fetchCount;
    // Simulate sentinel becoming visible (scrolled to top)
    observerCallback!(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );

    await waitFor(() => expect(fetchCount).toBeGreaterThan(initialCount));

    globalThis.IntersectionObserver = origIO;
  });

  it("does not fetch next page when no messages", async () => {
    let fetchCount = 0;
    let observerCallback: IntersectionObserverCallback | null = null;
    const origIO = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class MockIO {
      constructor(cb: IntersectionObserverCallback) {
        observerCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;

    server.use(
      http.get("*/api/projects/:id/agents/:aid/messages", () => {
        fetchCount++;
        return HttpResponse.json({ messages: [], hasMore: true });
      }),
    );
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);

    await waitForText(/Send a message to start working/);
    // Wait for the initial messages fetch to complete
    await new Promise((r) => setTimeout(r, 200));

    const prevCount = fetchCount;
    // Simulate sentinel becoming visible — should NOT trigger fetch when no messages
    observerCallback!(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );

    // Give time for any potential fetch
    await new Promise((r) => setTimeout(r, 100));
    expect(fetchCount).toBe(prevCount);

    globalThis.IntersectionObserver = origIO;
  });

  it("renders streaming text from props", async () => {
    setMessages(messages);
    const { rerender } = renderWithProviders(
      <ChatPanel agent={activeAgent} streamingText="Hello " />,
      routeOpts,
    );

    await waitFor(() => {
      expect(screen.getByText("Hello")).toBeInTheDocument();
    });

    rerender(<ChatPanel agent={activeAgent} streamingText="Hello world!" />);
    expect(screen.getByText("Hello world!")).toBeInTheDocument();

    rerender(<ChatPanel agent={activeAgent} streamingText="" />);
    expect(screen.queryByText("Hello world!")).not.toBeInTheDocument();
  });

  it("renders inter-agent message collapsed by default", async () => {
    const interAgentMsg: Message = {
      id: 10,
      role: "inter_agent",
      text: "Here is the analysis result",
      fromAgent: "researcher",
      ts: "2026-03-17T00:00:03Z",
    };
    setMessages([interAgentMsg]);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Message from researcher")).toBeInTheDocument();
    });
    expect(screen.queryByText("Here is the analysis result")).not.toBeInTheDocument();
  });

  it("expands inter-agent message on click", async () => {
    const interAgentMsg: Message = {
      id: 10,
      role: "inter_agent",
      text: "Here is the analysis result",
      fromAgent: "researcher",
      ts: "2026-03-17T00:00:03Z",
    };
    setMessages([interAgentMsg]);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Message from researcher")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Message from researcher"));
    expect(screen.getByText("Here is the analysis result")).toBeInTheDocument();
  });

  it("collapses inter-agent message on second click", async () => {
    const interAgentMsg: Message = {
      id: 10,
      role: "inter_agent",
      text: "Here is the analysis result",
      fromAgent: "researcher",
      ts: "2026-03-17T00:00:03Z",
    };
    setMessages([interAgentMsg]);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Message from researcher")).toBeInTheDocument();
    });
    const toggle = screen.getByText("Message from researcher");
    await userEvent.click(toggle);
    expect(screen.getByText("Here is the analysis result")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByText("Here is the analysis result")).not.toBeInTheDocument();
  });

  it("renders system message collapsed by default", async () => {
    const sysMsg: Message = {
      id: 20,
      role: "system",
      text: "Your outbox message was invalid",
      ts: "2026-03-17T00:00:04Z",
    };
    setMessages([sysMsg]);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("System notification")).toBeInTheDocument();
    });
    expect(screen.queryByText("Your outbox message was invalid")).not.toBeInTheDocument();
  });

  it("expands system message on click", async () => {
    const sysMsg: Message = {
      id: 20,
      role: "system",
      text: "Your outbox message was invalid",
      ts: "2026-03-17T00:00:04Z",
    };
    setMessages([sysMsg]);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("System notification")).toBeInTheDocument();
    });
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
    setMessages([sysMsg]);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("System notification")).toBeInTheDocument();
    });
    const toggle = screen.getByText("System notification");
    await userEvent.click(toggle);
    expect(screen.getByText("Your outbox message was invalid")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByText("Your outbox message was invalid")).not.toBeInTheDocument();
  });

  it("shows stop button when agent is busy", async () => {
    const busyAgent = { ...activeAgent, busy: true };
    setMessages(messages);
    renderWithProviders(<ChatPanel agent={busyAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByLabelText("Stop")).toBeInTheDocument();
    });
    expect(screen.queryByText("Send")).not.toBeInTheDocument();
  });

  it("sends interrupt event when stop button is clicked", async () => {
    let interruptedId: string | undefined;
    server.use(
      http.post("*/api/projects/:id/agents/:aid/interrupt", ({ params }) => {
        interruptedId = params.aid as string;
        return HttpResponse.json({ ok: true });
      }),
    );
    const busyAgent = { ...activeAgent, busy: true };
    setMessages(messages);
    renderWithProviders(<ChatPanel agent={busyAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByLabelText("Stop")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByLabelText("Stop"));
    await waitFor(() => expect(interruptedId).toBe("a1"));
  });

  it("shows send button when agent is not busy", async () => {
    setMessages(messages);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Send")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("Stop")).not.toBeInTheDocument();
  });

  it("shows thinking indicator when agent is busy and not streaming", async () => {
    const busyAgent = { ...activeAgent, busy: true };
    setMessages(messages);
    renderWithProviders(<ChatPanel agent={busyAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Thinking...")).toBeInTheDocument();
    });
  });

  it("hides thinking indicator when agent is busy but streaming", async () => {
    const busyAgent = { ...activeAgent, busy: true };
    setMessages(messages);
    renderWithProviders(<ChatPanel agent={busyAgent} streamingText="streaming..." />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("streaming...")).toBeInTheDocument();
    });
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  });

  it("does not show thinking indicator when agent is not busy", async () => {
    setMessages(messages);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Hello agent")).toBeInTheDocument();
    });
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  });

  it("shows idle message and restart button when agent is idle", async () => {
    const idleAgent: AgentOverview = { ...activeAgent, status: "idle" };
    setMessages(messages);
    renderWithProviders(<ChatPanel agent={idleAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText(/Agent is idle/)).toBeInTheDocument();
    });
    expect(screen.getByText("Restart")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Type a message...")).not.toBeInTheDocument();
  });

  it("sends restart event when restart button is clicked", async () => {
    let restartedId: string | undefined;
    server.use(
      http.post("*/api/projects/:id/agents/:aid/restart", ({ params }) => {
        restartedId = params.aid as string;
        return HttpResponse.json({ ok: true });
      }),
    );
    const idleAgent: AgentOverview = { ...activeAgent, status: "idle" };
    setMessages(messages);
    renderWithProviders(<ChatPanel agent={idleAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Restart")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Restart"));
    await waitFor(() => expect(restartedId).toBe("a1"));
  });

  it("shows attach button when agent is active", async () => {
    setMessages(messages);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByLabelText("Attach file")).toBeInTheDocument();
    });
  });

  it("renders file attachment as download link", async () => {
    const msgWithAtt: Message = {
      id: 30,
      role: "agent",
      text: "Here is your report",
      ts: "2026-03-17T00:00:05Z",
      attachments: [
        { id: "abc123", filename: "report.pdf", size: 1024, content_type: "application/pdf" },
      ],
    };
    setMessages([msgWithAtt]);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("report.pdf")).toBeInTheDocument();
    });
    const link = screen.getByText("report.pdf").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "/api/projects/test-project/agents/a1/attachments/abc123/report.pdf",
    );
  });

  it("renders image attachment as preview", async () => {
    const msgWithImg: Message = {
      id: 31,
      role: "agent",
      text: "",
      ts: "2026-03-17T00:00:06Z",
      attachments: [
        { id: "img001", filename: "screenshot.png", size: 2048, content_type: "image/png" },
      ],
    };
    setMessages([msgWithImg]);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      const img = screen.getByAltText("screenshot.png");
      expect(img).toHaveAttribute(
        "src",
        "/api/projects/test-project/agents/a1/attachments/img001/screenshot.png",
      );
    });
  });

  it("encodes attachment filename with spaces in URL", async () => {
    const msgWithSpacey: Message = {
      id: 32,
      role: "agent",
      text: "",
      ts: "2026-03-17T00:00:07Z",
      attachments: [
        {
          id: "img002",
          filename: "Screenshot 2026-04-10 at 10.30.00.png",
          size: 4096,
          content_type: "image/png",
        },
      ],
    };
    setMessages([msgWithSpacey]);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      const img = screen.getByAltText("Screenshot 2026-04-10 at 10.30.00.png");
      expect(img).toHaveAttribute(
        "src",
        "/api/projects/test-project/agents/a1/attachments/img002/Screenshot%202026-04-10%20at%2010.30.00.png",
      );
    });
  });

  it("sets aria-expanded on tool call toggle button", async () => {
    const toolMsg: Message = {
      id: 3,
      role: "tool_use",
      tool: "read_file",
      tool_use_id: "tu_1",
      input: { path: "/test.txt" },
      output: "file contents",
      isError: false,
      ts: "2026-03-17T00:00:02Z",
    };
    setMessages([toolMsg]);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("read_file")).toBeInTheDocument();
    });
    const toggle = screen.getByText("read_file").closest("button")!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("sets aria-expanded on inter-agent message toggle", async () => {
    const interAgentMsg: Message = {
      id: 10,
      role: "inter_agent",
      text: "Here is the analysis",
      fromAgent: "researcher",
      ts: "2026-03-17T00:00:03Z",
    };
    setMessages([interAgentMsg]);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Message from researcher")).toBeInTheDocument();
    });
    const toggle = screen.getByText("Message from researcher").closest("button")!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("sets aria-expanded on system message toggle", async () => {
    const sysMsg: Message = {
      id: 20,
      role: "system",
      text: "System message content",
      ts: "2026-03-17T00:00:04Z",
    };
    setMessages([sysMsg]);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("System notification")).toBeInTheDocument();
    });
    const toggle = screen.getByText("System notification").closest("button")!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("renders user message with attachments", async () => {
    const userMsgWithAtt: Message = {
      id: 32,
      role: "user",
      text: "Check this file",
      ts: "2026-03-17T00:00:07Z",
      attachments: [{ id: "def456", filename: "data.csv", size: 512, content_type: "text/csv" }],
    };
    setMessages([userMsgWithAtt]);
    renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Check this file")).toBeInTheDocument();
    });
    expect(screen.getByText("data.csv")).toBeInTheDocument();
  });

  describe("timestamps and day separators", () => {
    // Pin Date.now so timestamps are deterministic
    const NOW = new Date(2026, 2, 17, 12, 0, 0).getTime();
    let origDateNow: () => number;

    beforeEach(() => {
      origDateNow = Date.now;
      Date.now = () => NOW;
    });

    afterEach(() => {
      Date.now = origDateNow;
    });

    it("shows day separator for messages", async () => {
      // Messages are on 2026-03-17 which is "today" with our mocked NOW
      const todayMsgs: Message[] = [
        { id: 1, role: "user", text: "Hi", ts: new Date(NOW - 120_000).toISOString() },
        { id: 2, role: "agent", text: "Hello", ts: new Date(NOW - 60_000).toISOString() },
      ];
      setMessages(todayMsgs);
      renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
      await waitFor(() => {
        expect(screen.getByText("Today")).toBeInTheDocument();
      });
    });

    it("shows separate day separators for messages on different days", async () => {
      const multiDayMsgs: Message[] = [
        {
          id: 1,
          role: "user",
          text: "Old message",
          ts: new Date(2026, 2, 15, 10, 0, 0).toISOString(),
        },
        { id: 2, role: "agent", text: "Reply", ts: new Date(NOW - 60_000).toISOString() },
      ];
      setMessages(multiDayMsgs);
      renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
      await waitFor(() => {
        expect(screen.getByText("Today")).toBeInTheDocument();
      });
      // The older message should have a different day label containing 2026
      const separators = screen.getAllByText(/Today|2026/);
      expect(separators.length).toBe(2);
    });

    it("shows timestamps below user and agent messages", async () => {
      const recentMsgs: Message[] = [
        { id: 1, role: "user", text: "Hi", ts: new Date(NOW - 120_000).toISOString() },
        { id: 2, role: "agent", text: "Hello", ts: new Date(NOW - 60_000).toISOString() },
      ];
      setMessages(recentMsgs);
      renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
      await waitFor(() => {
        expect(screen.getByText("Hi")).toBeInTheDocument();
      });
      const timestamps = screen.getAllByText(/ago/);
      expect(timestamps.length).toBe(2);
    });

    it("does not show timestamp for tool_use messages", async () => {
      const toolMsg: Message = {
        id: 3,
        role: "tool_use",
        tool: "read_file",
        tool_use_id: "tu_1",
        input: { path: "/test.txt" },
        output: "contents",
        isError: false,
        ts: new Date(NOW - 60_000).toISOString(),
      };
      setMessages([toolMsg]);
      renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
      await waitFor(() => {
        expect(screen.getByText("read_file")).toBeInTheDocument();
      });
      expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
    });
  });

  describe("multi-file upload", () => {
    it("adds multiple files to pending list via file input", async () => {
      renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);

      await waitFor(() => {
        expect(document.querySelector('input[type="file"]')).toBeTruthy();
      });

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.multiple).toBe(true);

      const files = [createFile("a.txt", 100), createFile("b.txt", 200)];
      const dt = createDataTransfer(files);
      Object.defineProperty(input, "files", { value: dt.files, configurable: true });
      fireEvent.change(input);

      await screen.findByText("a.txt");
      expect(screen.getByText("b.txt")).toBeInTheDocument();
    });

    it("shows error when file exceeds 128 MB limit", async () => {
      renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);

      await waitFor(() => {
        expect(document.querySelector('input[type="file"]')).toBeTruthy();
      });

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;

      const bigFile = createFile("huge.bin", 129 * 1024 * 1024);
      const dt = createDataTransfer([bigFile]);
      Object.defineProperty(input, "files", { value: dt.files, configurable: true });
      fireEvent.change(input);

      await screen.findByText(/File is larger than/);
    });

    it("completes all concurrent uploads (not just the last one)", async () => {
      let uploadCount = 0;
      server.use(
        http.post("*/api/projects/:id/agents/:aid/attachments", () => {
          uploadCount += 1;
          return HttpResponse.json(
            {
              id: `att-${uploadCount}`,
              filename: `file${uploadCount}.txt`,
              content_type: "text/plain",
              size: 100,
            },
            { status: 201 },
          );
        }),
      );

      renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);

      await waitFor(() => {
        expect(document.querySelector('input[type="file"]')).toBeTruthy();
      });

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const files = [createFile("x.txt", 10), createFile("y.txt", 20), createFile("z.txt", 30)];
      const dt = createDataTransfer(files);
      Object.defineProperty(input, "files", { value: dt.files, configurable: true });
      fireEvent.change(input);

      // All three files should show as completed (check icon appears for each)
      await waitFor(() => {
        const checks = document.querySelectorAll("svg.lucide-check");
        expect(checks.length).toBe(3);
      });
    });

    it("preserves pending files when send fails", async () => {
      server.use(
        http.post("*/api/projects/:id/agents/:aid/message", () =>
          HttpResponse.json({ error: "Network error" }, { status: 500 }),
        ),
      );
      renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);

      await waitFor(() => {
        expect(document.querySelector('input[type="file"]')).toBeTruthy();
      });

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;

      const dt = createDataTransfer([createFile("keep.txt", 10)]);
      Object.defineProperty(input, "files", { value: dt.files, configurable: true });
      fireEvent.change(input);

      await screen.findByText("keep.txt");

      await userEvent.click(screen.getByText("Send"));

      // File should still be in pending list after error
      await waitFor(() => {
        expect(screen.getByText("keep.txt")).toBeInTheDocument();
      });
    });
  });

  describe("file input", () => {
    it("renders hidden file input with multiple attribute", async () => {
      renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
      await waitFor(() => {
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        expect(input).toBeTruthy();
        expect(input.multiple).toBe(true);
      });
    });

    it("processes files selected via file input", async () => {
      renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);

      await waitFor(() => {
        expect(document.querySelector('input[type="file"]')).toBeTruthy();
      });

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;

      const files = [createFile("via-input.txt", 100)];
      const dt = createDataTransfer(files);
      Object.defineProperty(input, "files", { value: dt.files, configurable: true });
      fireEvent.change(input);

      await screen.findByText("via-input.txt");
    });
  });

  describe("copy button", () => {
    const writeTextMock = mock(() => Promise.resolve());

    beforeEach(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      });
      writeTextMock.mockClear();
    });

    it("shows copy button on agent messages", async () => {
      setMessages(messages);
      renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
      await waitFor(() => {
        expect(screen.getByLabelText("Copy message")).toBeInTheDocument();
      });
    });

    it("does not show copy button on user messages", async () => {
      const userOnly: Message[] = [
        { id: 1, role: "user", text: "Hello", ts: "2026-03-17T00:00:00Z" },
      ];
      setMessages(userOnly);
      renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
      await waitFor(() => {
        expect(screen.getByText("Hello")).toBeInTheDocument();
      });
      expect(screen.queryByLabelText("Copy message")).not.toBeInTheDocument();
    });

    it("copies agent message text on click", async () => {
      setMessages(messages);
      renderWithProviders(<ChatPanel agent={activeAgent} />, routeOpts);
      await waitFor(() => {
        expect(screen.getByLabelText("Copy message")).toBeInTheDocument();
      });
      await userEvent.click(screen.getByLabelText("Copy message"));
      expect(writeTextMock).toHaveBeenCalledWith("Hello human");
    });
  });
});
