import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import ChatHeader from "../react-components/ChatHeader";
import { type Agent } from "../react-components/types";

const agent: Agent = {
  id: "a1",
  name: "test-agent",
  status: "active",
  model: "claude-sonnet-4-6",
  harness: "claude_code",
};

describe("ChatHeader", () => {
  it("renders agent name and status", () => {
    render(<ChatHeader agent={agent} pushEvent={vi.fn()} />);
    expect(screen.getByText("test-agent")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("calls pushEvent with clear-session when Clear Session is clicked", async () => {
    const pushEvent = vi.fn();
    const user = userEvent.setup();
    render(<ChatHeader agent={agent} pushEvent={pushEvent} />);

    await user.click(screen.getByRole("button", { name: "Agent options" }));
    await user.click(screen.getByText("Clear Session"));

    expect(pushEvent).toHaveBeenCalledWith("clear-session", {});
  });

  it("renders mobile menu toggle when onMenuToggle is provided", () => {
    render(<ChatHeader agent={agent} pushEvent={vi.fn()} onMenuToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
  });
});
