import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import ActivityLog from "../react-components/ActivityLog";
import type { InterAgentMessage } from "../react-components/types";

const messages: InterAgentMessage[] = [
  { id: 3, from_agent: "Alice", to_agent: "Bob", text: "Hello Bob!", ts: "2026-03-17T10:00:00Z" },
  { id: 2, from_agent: "Bob", to_agent: "Alice", text: "Hi Alice, how are you?", ts: "2026-03-17T09:59:00Z" },
];

describe("ActivityLog", () => {
  it("renders empty state when no messages", () => {
    render(<ActivityLog messages={[]} hasMore={false} pushEvent={vi.fn()} />);
    expect(screen.getByText(/No inter-agent messages yet/)).toBeInTheDocument();
  });

  it("renders messages with sender and recipient", () => {
    render(<ActivityLog messages={messages} hasMore={false} pushEvent={vi.fn()} />);
    expect(screen.getAllByText("Alice")).toHaveLength(2); // sender in msg1, recipient in msg2
    expect(screen.getAllByText("Bob")).toHaveLength(2); // recipient in msg1, sender in msg2
    expect(screen.getByText("Hello Bob!")).toBeInTheDocument();
    expect(screen.getByText("Hi Alice, how are you?")).toBeInTheDocument();
  });

  it("shows Load more button when hasMore is true", () => {
    render(<ActivityLog messages={messages} hasMore={true} pushEvent={vi.fn()} />);
    expect(screen.getByText("Load more")).toBeInTheDocument();
  });

  it("does not show Load more when hasMore is false", () => {
    render(<ActivityLog messages={messages} hasMore={false} pushEvent={vi.fn()} />);
    expect(screen.queryByText("Load more")).not.toBeInTheDocument();
  });

  it("calls pushEvent with load-more-messages on Load more click", async () => {
    const pushEvent = vi.fn();
    render(<ActivityLog messages={messages} hasMore={true} pushEvent={pushEvent} />);
    await userEvent.click(screen.getByText("Load more"));
    expect(pushEvent).toHaveBeenCalledWith("load-more-messages", { before: 2 });
  });

  it("truncates long messages and shows expand toggle", async () => {
    const longText = "A".repeat(250);
    const longMessages: InterAgentMessage[] = [
      { id: 1, from_agent: "Alice", to_agent: "Bob", text: longText, ts: "2026-03-17T10:00:00Z" },
    ];
    render(<ActivityLog messages={longMessages} hasMore={false} pushEvent={vi.fn()} />);
    expect(screen.getByText("Show more")).toBeInTheDocument();
    expect(screen.getByText(/\.\.\.$/)).toBeInTheDocument();

    await userEvent.click(screen.getByText("Show more"));
    expect(screen.getByText("Show less")).toBeInTheDocument();
  });
});
