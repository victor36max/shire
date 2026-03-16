import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import AgentShow from "../react-components/AgentShow";

const agent = {
  id: 1,
  name: "Test Agent",
  status: "active",
  model: "claude-sonnet-4-6",
  system_prompt: "You are a helpful assistant.",
};

describe("AgentShow", () => {
  it("renders agent details", () => {
    render(<AgentShow agent={agent} pushEvent={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Test Agent" })).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
    expect(screen.getByText("You are a helpful assistant.")).toBeInTheDocument();
    expect(screen.getAllByText("active")).toHaveLength(2); // header badge + detail badge
  });

  it("shows fallback for missing model and system prompt", () => {
    render(
      <AgentShow
        agent={{ ...agent, model: null, system_prompt: null }}
        pushEvent={vi.fn()}
      />
    );
    expect(screen.getAllByText("Not set")).toHaveLength(2);
  });

  it("calls pushEvent with edit on Edit click", async () => {
    const pushEvent = vi.fn();
    render(<AgentShow agent={agent} pushEvent={pushEvent} />);
    await userEvent.click(screen.getByText("Edit"));
    expect(pushEvent).toHaveBeenCalledWith("edit", { id: 1 });
  });
});
