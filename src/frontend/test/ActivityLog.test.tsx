import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, mock } from "bun:test";
import ActivityLog from "../components/ActivityLog";
import type { InterAgentMessage } from "../components/types";

const messages: InterAgentMessage[] = [
  { id: 3, fromAgent: "Alice", toAgent: "Bob", text: "Hello Bob!", ts: "2026-03-17T10:00:00Z" },
  {
    id: 2,
    fromAgent: "Bob",
    toAgent: "Alice",
    text: "Hi Alice, how are you?",
    ts: "2026-03-17T09:59:00Z",
  },
];

const defaultProps = {
  messages,
  hasMore: false,
  loadingMore: false,
  onLoadMore: mock(() => {}),
};

describe("ActivityLog", () => {
  it("renders empty state when no messages", () => {
    render(<ActivityLog {...defaultProps} messages={[]} />);
    expect(screen.getByText(/No inter-agent messages yet/)).toBeInTheDocument();
  });

  it("renders messages with sender and recipient", () => {
    render(<ActivityLog {...defaultProps} />);
    expect(screen.getAllByText("Alice")).toHaveLength(2); // sender in msg1, recipient in msg2
    expect(screen.getAllByText("Bob")).toHaveLength(2); // recipient in msg1, sender in msg2
    expect(screen.getByText("Hello Bob!")).toBeInTheDocument();
    expect(screen.getByText("Hi Alice, how are you?")).toBeInTheDocument();
  });

  it("shows loading spinner when loadingMore is true", () => {
    const { container } = render(
      <ActivityLog {...defaultProps} hasMore={true} loadingMore={true} />,
    );
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("does not show loading spinner when not loading more", () => {
    const { container } = render(
      <ActivityLog {...defaultProps} hasMore={true} loadingMore={false} />,
    );
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  it("calls onLoadMore when scrolled near bottom with hasMore", () => {
    const onLoadMore = mock(() => {});
    const { container } = render(
      <ActivityLog {...defaultProps} hasMore={true} onLoadMore={onLoadMore} />,
    );
    const scrollContainer = container.firstElementChild as HTMLElement;
    onLoadMore.mockClear(); // Clear any calls from auto-load useEffect

    Object.defineProperty(scrollContainer, "scrollHeight", {
      get: () => 1000,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, "clientHeight", {
      get: () => 400,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, "scrollTop", { get: () => 550, configurable: true });
    fireEvent.scroll(scrollContainer);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not call onLoadMore when not near bottom", () => {
    const onLoadMore = mock(() => {});
    const { container } = render(
      <ActivityLog {...defaultProps} hasMore={true} onLoadMore={onLoadMore} />,
    );
    const scrollContainer = container.firstElementChild as HTMLElement;
    onLoadMore.mockClear(); // Clear any calls from auto-load useEffect

    Object.defineProperty(scrollContainer, "scrollHeight", {
      get: () => 1000,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, "clientHeight", {
      get: () => 400,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, "scrollTop", { get: () => 100, configurable: true });
    fireEvent.scroll(scrollContainer);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("does not call onLoadMore when already loading", () => {
    const onLoadMore = mock(() => {});
    const { container } = render(
      <ActivityLog {...defaultProps} hasMore={true} loadingMore={true} onLoadMore={onLoadMore} />,
    );
    const scrollContainer = container.firstElementChild as HTMLElement;

    Object.defineProperty(scrollContainer, "scrollHeight", {
      get: () => 1000,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, "clientHeight", {
      get: () => 400,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, "scrollTop", { get: () => 550, configurable: true });

    fireEvent.scroll(scrollContainer);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("auto-loads next page when content does not overflow", () => {
    const onLoadMore = mock(() => {});
    // Override prototype so newly created elements report no overflow
    const origSH = Object.getOwnPropertyDescriptor(HTMLDivElement.prototype, "scrollHeight");
    const origCH = Object.getOwnPropertyDescriptor(HTMLDivElement.prototype, "clientHeight");
    Object.defineProperty(HTMLDivElement.prototype, "scrollHeight", {
      get: () => 300,
      configurable: true,
    });
    Object.defineProperty(HTMLDivElement.prototype, "clientHeight", {
      get: () => 400,
      configurable: true,
    });

    render(<ActivityLog {...defaultProps} hasMore={true} onLoadMore={onLoadMore} />);

    // The useEffect fires on render — onLoadMore should have been called
    expect(onLoadMore).toHaveBeenCalled();

    // Restore
    if (origSH) Object.defineProperty(HTMLDivElement.prototype, "scrollHeight", origSH);
    if (origCH) Object.defineProperty(HTMLDivElement.prototype, "clientHeight", origCH);
  });

  it("renders system messages without from/to arrow", () => {
    const systemMessages: InterAgentMessage[] = [
      {
        id: 10,
        fromAgent: "",
        toAgent: "",
        text: "Session cleared",
        ts: "2026-03-17T10:00:00Z",
        role: "system",
      },
      {
        id: 11,
        fromAgent: "",
        toAgent: "",
        text: "Error: something went wrong",
        ts: "2026-03-17T10:01:00Z",
        role: "system",
      },
    ];
    render(<ActivityLog {...defaultProps} messages={systemMessages} />);
    expect(screen.getByText("Session cleared")).toBeInTheDocument();
    expect(screen.getByText("Error: something went wrong")).toBeInTheDocument();
    // Should show "System" label, not empty arrows
    expect(screen.getAllByText("System")).toHaveLength(2);
  });

  it("truncates long messages and shows expand toggle", async () => {
    const longText = "A".repeat(250);
    const longMessages: InterAgentMessage[] = [
      { id: 1, fromAgent: "Alice", toAgent: "Bob", text: longText, ts: "2026-03-17T10:00:00Z" },
    ];
    render(<ActivityLog {...defaultProps} messages={longMessages} />);
    expect(screen.getByText("Show more")).toBeInTheDocument();
    expect(screen.getByText(/\.\.\.$/)).toBeInTheDocument();

    await userEvent.click(screen.getByText("Show more"));
    expect(screen.getByText("Show less")).toBeInTheDocument();
  });
});
