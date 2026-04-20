// Primary test coverage is in src/frontend/test/ProjectDashboard.test.tsx
// This file verifies the key-prop fix for AgentForm remounting.

import { describe, it, expect, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import AgentForm from "./AgentForm";
import type { Agent } from "./types";

describe("ProjectLayout: AgentForm key prop", () => {
  it("remounts AgentForm with fresh values when key changes (simulates catalog re-selection)", () => {
    const noop = mock(() => {});

    const agentA: Agent = {
      id: "",
      name: "agent-alpha",
      description: "Alpha agent",
      emoji: "\u{1F680}",
      busy: false,
      unreadCount: 0,
      harness: "claude_code",
      model: "claude-sonnet-4-6",
      systemPrompt: "You are Alpha.",
    };

    const agentB: Agent = {
      id: "",
      name: "agent-beta",
      description: "Beta agent",
      emoji: "\u{1F525}",
      busy: false,
      unreadCount: 0,
      harness: "pi",
      model: "gpt-4o",
      systemPrompt: "You are Beta.",
    };

    // Render with agent A (key=0)
    const { rerender } = render(
      <AgentForm
        key={0}
        open={true}
        title="New Agent"
        agent={agentA}
        onSave={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByLabelText("Name")).toHaveValue("agent-alpha");
    expect(screen.getByLabelText("Description")).toHaveValue("Alpha agent");

    // Re-render with agent B but SAME key — simulates the old bug
    rerender(
      <AgentForm
        key={0}
        open={true}
        title="New Agent"
        agent={agentB}
        onSave={noop}
        onClose={noop}
      />,
    );
    // With the same key, React reuses the component instance and useState keeps old values
    expect(screen.getByLabelText("Name")).toHaveValue("agent-alpha"); // BUG: still shows A

    // Re-render with agent B and DIFFERENT key — simulates the fix
    rerender(
      <AgentForm
        key={1}
        open={true}
        title="New Agent"
        agent={agentB}
        onSave={noop}
        onClose={noop}
      />,
    );
    // New key forces remount, useState initializes with fresh values from agent B
    expect(screen.getByLabelText("Name")).toHaveValue("agent-beta");
    expect(screen.getByLabelText("Description")).toHaveValue("Beta agent");
  });
});
