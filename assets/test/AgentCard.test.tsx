import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import AgentCard from "../react-components/AgentCard";
import { type Agent } from "../react-components/types";

const agent: Agent = {
  id: 1,
  name: "Test Agent",
  status: "active",
  model: "claude-sonnet-4-6",
  system_prompt: "You are helpful.",
  harness: "pi",
  recipe: "name: Test Agent\nharness: pi\nmodel: claude-sonnet-4-6",
  is_base: false,
};

describe("AgentCard", () => {
  it("renders agent name, status, and harness/model", () => {
    render(<AgentCard agent={agent} />);
    expect(screen.getByText("Test Agent")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("shows harness label", () => {
    render(<AgentCard agent={agent} />);
    expect(screen.getByText("Pi")).toBeInTheDocument();
  });

  it("shows model when present", () => {
    render(<AgentCard agent={agent} />);
    expect(screen.getByText(/claude-sonnet-4-6/)).toBeInTheDocument();
  });

  it("shows description when present", () => {
    render(<AgentCard agent={{ ...agent, description: "A helpful agent" }} />);
    expect(screen.getByText("A helpful agent")).toBeInTheDocument();
  });

  it("shows script count badge", () => {
    render(
      <AgentCard
        agent={{ ...agent, scripts: [{ name: "setup", run: "echo hi" }] }}
      />,
    );
    expect(screen.getByText("1 script")).toBeInTheDocument();
  });

  it("shows fallback when model is null", () => {
    render(<AgentCard agent={{ ...agent, model: null }} />);
    expect(screen.getByText("Pi")).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn();
    render(<AgentCard agent={agent} onClick={onClick} />);
    await userEvent.click(screen.getByText("Test Agent"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
