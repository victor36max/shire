import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import AgentCard from "../react-components/AgentCard";

const agent = {
  id: 1,
  name: "Test Agent",
  status: "active",
  model: "claude-sonnet-4-6",
  system_prompt: "You are helpful.",
};

describe("AgentCard", () => {
  it("renders agent name, status, and model", () => {
    render(<AgentCard agent={agent} />);
    expect(screen.getByText("Test Agent")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
  });

  it("renders system prompt when present", () => {
    render(<AgentCard agent={agent} />);
    expect(screen.getByText("You are helpful.")).toBeInTheDocument();
  });

  it("shows fallback when model is null", () => {
    render(<AgentCard agent={{ ...agent, model: null }} />);
    expect(screen.getByText("No model set")).toBeInTheDocument();
  });

  it("hides system prompt when null", () => {
    render(<AgentCard agent={{ ...agent, system_prompt: null }} />);
    expect(screen.queryByText("You are helpful.")).not.toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn();
    render(<AgentCard agent={agent} onClick={onClick} />);
    await userEvent.click(screen.getByText("Test Agent"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
