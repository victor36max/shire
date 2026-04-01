import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, mock } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import ChatHeader from "../components/ChatHeader";
import { type AgentOverview } from "../components/types";
import { renderWithProviders } from "./test-utils";

const agent: AgentOverview = {
  id: "a1",
  name: "test-agent",
  status: "active",
  busy: false,
  unreadCount: 0,
};

/**
 * ChatHeader calls useProjectId() which reads projectName from useParams()
 * and resolves the project id from GET /api/projects.
 * We render at route "/projects/test-project" and let the default MSW handler
 * return [{ id: "p1", name: "test-project", status: "running" }].
 */
function renderChatHeader(props?: { onMenuToggle?: () => void }) {
  return renderWithProviders(<ChatHeader agent={agent} {...props} />, {
    route: "/projects/test-project",
    routePath: "/projects/:projectName",
  });
}

describe("ChatHeader", () => {
  it("renders agent name and status", () => {
    renderChatHeader();
    expect(screen.getByText("test-agent")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("sends clear session request when Clear Session is clicked", async () => {
    let clearCalled = false;
    server.use(
      http.post("*/api/projects/:id/agents/:aid/clear", () => {
        clearCalled = true;
        return HttpResponse.json({ ok: true });
      }),
    );

    const user = userEvent.setup();
    renderChatHeader();

    // Wait for project data to load so projectId is resolved
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Agent options" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Agent options" }));
    await user.click(screen.getByText("Clear Session"));

    await waitFor(() => expect(clearCalled).toBe(true));
  });

  it("renders mobile menu toggle when onMenuToggle is provided", () => {
    renderChatHeader({ onMenuToggle: mock(() => {}) });
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
  });
});
