import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, mock } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw-server";
import { type Agent } from "../components/types";
import { renderWithProviders } from "../test/test-utils";

const agent: Agent = {
  id: "a1",
  name: "Test Agent",
  busy: false,
  unreadCount: 0,
  model: "claude-sonnet-4-6",
  systemPrompt: "You are a helpful assistant.",
  harness: "claude_code",
};

// Mock Terminal component to avoid xterm/canvas dependencies
mock.module("../components/Terminal", () => ({
  default: ({ pushEvent: _pushEvent }: { pushEvent: unknown }) => (
    <div data-testid="terminal-mock">Terminal Component</div>
  ),
}));

import AgentShow from "../components/AgentShow";

function setAgentData(
  detail: Partial<Agent> = {},
  agentsList?: Array<{ id: string; name: string }>,
) {
  const merged = { ...agent, ...detail };
  const agents = agentsList ?? [{ id: merged.id, name: merged.name }];
  server.use(
    http.get("*/api/projects/:id/agents", () => HttpResponse.json(agents)),
    http.get("*/api/projects/:id/agents/:aid", () => HttpResponse.json(merged)),
  );
}

const routeOpts = {
  route: "/projects/test-project/agents/Test Agent/details",
  routePath: "/projects/:projectName/agents/:agentName/details",
};

async function renderAgentShow(
  detail: Partial<Agent> = {},
  agentsList?: Array<{ id: string; name: string }>,
) {
  setAgentData(detail, agentsList);
  renderWithProviders(<AgentShow />, routeOpts);
  // Wait for data to load
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: agent.name })).toBeInTheDocument();
  });
}

async function openMoreMenu() {
  await userEvent.click(screen.getByRole("button", { name: "More actions" }));
}

describe("AgentShow", () => {
  it("renders agent details", async () => {
    await renderAgentShow();
    expect(screen.getByRole("heading", { name: "Test Agent" })).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
    expect(screen.getByText("You are a helpful assistant.")).toBeInTheDocument();
  });

  it("shows fallback for missing model and system prompt", async () => {
    await renderAgentShow({ model: undefined, systemPrompt: undefined });
    expect(screen.getAllByText("Not set")).toHaveLength(2);
  });

  it("shows Delete Agent in more menu", async () => {
    await renderAgentShow();
    await openMoreMenu();
    expect(screen.getByText("Delete Agent")).toBeInTheDocument();
  });

  it("shows Restart button for active agent", async () => {
    await renderAgentShow();
    expect(screen.getByText("Restart Agent")).toBeInTheDocument();
  });

  it("calls restart after confirming restart", async () => {
    let restartedId: string | undefined;
    server.use(
      http.post("*/api/projects/:id/agents/:aid/restart", ({ params }) => {
        restartedId = params.aid as string;
        return HttpResponse.json({ ok: true });
      }),
    );
    await renderAgentShow();
    await userEvent.click(screen.getByText("Restart Agent"));
    await userEvent.click(screen.getByText("Restart"));
    await waitFor(() => expect(restartedId).toBe("a1"));
  });

  it("calls delete after confirming via more menu", async () => {
    let deletedId: string | undefined;
    server.use(
      http.delete("*/api/projects/:id/agents/:aid", ({ params }) => {
        deletedId = params.aid as string;
        return HttpResponse.json({ ok: true });
      }),
    );
    await renderAgentShow();
    await openMoreMenu();
    await userEvent.click(screen.getByText("Delete Agent"));
    await userEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(deletedId).toBe("a1"));
  });

  it("displays harness badge", async () => {
    await renderAgentShow();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("displays Pi harness", async () => {
    await renderAgentShow({ harness: "pi" });
    expect(screen.getByText("Pi")).toBeInTheDocument();
  });

  it("shows Edit button and opens edit form dialog", async () => {
    await renderAgentShow();
    const editBtn = screen.getByRole("button", { name: /edit/i });
    expect(editBtn).toBeInTheDocument();
    await userEvent.click(editBtn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Edit Agent")).toBeInTheDocument();
  });

  it("renders system prompt in its own card", async () => {
    await renderAgentShow();
    expect(screen.getByText("System Prompt")).toBeInTheDocument();
    expect(screen.getByText("You are a helpful assistant.")).toBeInTheDocument();
  });
});
