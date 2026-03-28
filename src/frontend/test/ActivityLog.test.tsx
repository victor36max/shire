import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
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
  onLoadMore: vi.fn(),
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
    const onLoadMore = vi.fn();
    // Mock Element.prototype so the scroll container has overflow from the start
    const originalScrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight");
    const originalClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");
    Object.defineProperty(Element.prototype, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(Element.prototype, "clientHeight", { value: 400, configurable: true });

    const { container } = render(
      <ActivityLog {...defaultProps} hasMore={true} onLoadMore={onLoadMore} />,
    );
    const scrollContainer = container.firstElementChild as HTMLElement;

    // useEffect saw overflow, so onLoadMore should NOT have been called yet
    expect(onLoadMore).not.toHaveBeenCalled();

    Object.defineProperty(scrollContainer, "scrollTop", { value: 550, configurable: true });
    fireEvent.scroll(scrollContainer);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Restore
    if (originalScrollHeight)
      Object.defineProperty(Element.prototype, "scrollHeight", originalScrollHeight);
    if (originalClientHeight)
      Object.defineProperty(Element.prototype, "clientHeight", originalClientHeight);
  });

  it("does not call onLoadMore when not near bottom", () => {
    const onLoadMore = vi.fn();
    const originalScrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight");
    const originalClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");
    Object.defineProperty(Element.prototype, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(Element.prototype, "clientHeight", { value: 400, configurable: true });

    const { container } = render(
      <ActivityLog {...defaultProps} hasMore={true} onLoadMore={onLoadMore} />,
    );
    const scrollContainer = container.firstElementChild as HTMLElement;

    Object.defineProperty(scrollContainer, "scrollTop", { value: 100, configurable: true });
    fireEvent.scroll(scrollContainer);
    expect(onLoadMore).not.toHaveBeenCalled();

    if (originalScrollHeight)
      Object.defineProperty(Element.prototype, "scrollHeight", originalScrollHeight);
    if (originalClientHeight)
      Object.defineProperty(Element.prototype, "clientHeight", originalClientHeight);
  });

  it("does not call onLoadMore when already loading", () => {
    const onLoadMore = vi.fn();
    const { container } = render(
      <ActivityLog {...defaultProps} hasMore={true} loadingMore={true} onLoadMore={onLoadMore} />,
    );
    const scrollContainer = container.firstElementChild as HTMLElement;

    Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(scrollContainer, "scrollTop", { value: 550, configurable: true });

    fireEvent.scroll(scrollContainer);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("auto-loads next page when content does not overflow", () => {
    const onLoadMore = vi.fn();
    const { container } = render(
      <ActivityLog {...defaultProps} hasMore={true} onLoadMore={onLoadMore} />,
    );
    const scrollContainer = container.firstElementChild as HTMLElement;

    // Simulate content fitting within the viewport (no overflow)
    Object.defineProperty(scrollContainer, "scrollHeight", { value: 300, configurable: true });
    Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });

    // The useEffect fires on render — onLoadMore should have been called
    expect(onLoadMore).toHaveBeenCalled();
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
