import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, mock } from "bun:test";
import AgentForm from "./AgentForm";
import type { Agent } from "./types";

const noop = mock(() => {});

function renderForm(agent: Agent | null = null) {
  return render(
    <AgentForm open={true} title="New Agent" agent={agent} onSave={noop} onClose={noop} />,
  );
}

describe("AgentForm key-based reset", () => {
  it("initializes state from agent prop without useEffect", () => {
    const agent: Agent = {
      id: "a1",
      name: "my-agent",
      description: "A test agent",
      status: "active",
      busy: false,
      unreadCount: 0,
      harness: "claude_code",
      model: "claude-sonnet-4-6",
      systemPrompt: "Be helpful.",
    };

    renderForm(agent);
    expect(screen.getByLabelText("Name")).toHaveValue("my-agent");
    expect(screen.getByLabelText("Description")).toHaveValue("A test agent");
    expect(screen.getByLabelText("Model")).toHaveValue("claude-sonnet-4-6");
    expect(screen.getByLabelText("System Prompt")).toHaveValue("Be helpful.");
  });

  it("initializes with empty values when agent is null", () => {
    renderForm(null);
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("");
    expect(screen.getByLabelText("Model")).toHaveValue("");
    expect(screen.getByLabelText("System Prompt")).toHaveValue("");
  });

  it("resets form state when remounted with new key (different agent)", async () => {
    const agent1: Agent = {
      id: "a1",
      name: "agent-one",
      status: "active",
      busy: false,
      unreadCount: 0,
      harness: "claude_code",
    };
    const agent2: Agent = {
      id: "a2",
      name: "agent-two",
      status: "active",
      busy: false,
      unreadCount: 0,
      harness: "pi",
    };

    const { unmount } = render(
      <AgentForm
        key={agent1.id}
        open={true}
        title="Edit Agent"
        agent={agent1}
        onSave={noop}
        onClose={noop}
      />,
    );

    expect(screen.getByLabelText("Name")).toHaveValue("agent-one");

    // Simulate user editing the name
    const user = userEvent.setup();
    const nameInput = screen.getByLabelText("Name");
    await user.clear(nameInput);
    await user.paste("modified-name");
    expect(nameInput).toHaveValue("modified-name");

    // Unmount and remount with different key (simulates parent changing key)
    unmount();
    render(
      <AgentForm
        key={agent2.id}
        open={true}
        title="Edit Agent"
        agent={agent2}
        onSave={noop}
        onClose={noop}
      />,
    );

    // Should show agent2's name, not the modified value
    expect(screen.getByLabelText("Name")).toHaveValue("agent-two");
  });
});
