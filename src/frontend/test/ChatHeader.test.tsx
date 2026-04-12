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
  busy: false,
  unreadCount: 0,
};

const agentWithEmoji: AgentOverview = {
  ...agent,
  emoji: "\u{1F680}",
};

/**
 * ChatHeader calls useProjectId() which reads projectName from useParams()
 * and resolves the project id from GET /api/projects.
 * We render at route "/projects/test-project" and let the default MSW handler
 * return [{ id: "p1", name: "test-project" }].
 */
function renderChatHeader(props?: { onMenuToggle?: () => void; agentOverride?: AgentOverview }) {
  return renderWithProviders(
    <ChatHeader agent={props?.agentOverride ?? agent} onMenuToggle={props?.onMenuToggle} />,
    {
      route: "/projects/test-project/agents/test-agent",
      routePath: "/projects/:projectName/agents/:agentName",
    },
  );
}

describe("ChatHeader", () => {
  it("renders agent name", () => {
    renderChatHeader();
    expect(screen.getByText("test-agent")).toBeInTheDocument();
  });

  it("renders default robot emoji when no emoji set", () => {
    renderChatHeader();
    expect(screen.getByText("\u{1F916}")).toBeInTheDocument();
  });

  it("renders custom emoji when set", () => {
    renderChatHeader({ agentOverride: agentWithEmoji });
    expect(screen.getByText("\u{1F680}")).toBeInTheDocument();
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

  it("renders Settings option in dropdown", async () => {
    const user = userEvent.setup();
    renderChatHeader();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Agent options" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Agent options" }));
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders Delete option in dropdown and shows confirmation dialog", async () => {
    const user = userEvent.setup();
    renderChatHeader();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Agent options" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Agent options" }));
    await user.click(screen.getByText("Delete"));

    expect(screen.getByText("Delete Agent")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("executes delete when confirmed", async () => {
    let deletedId: string | undefined;
    server.use(
      http.delete("*/api/projects/:id/agents/:aid", ({ params }) => {
        deletedId = params.aid as string;
        return HttpResponse.json({ ok: true });
      }),
    );

    const user = userEvent.setup();
    renderChatHeader();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Agent options" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Agent options" }));
    await user.click(screen.getByText("Delete"));

    const alertDialog = screen.getByRole("alertdialog");
    const confirmButton = alertDialog.querySelector("button:last-of-type");
    expect(confirmButton).toBeTruthy();
    await user.click(confirmButton!);

    await waitFor(() => expect(deletedId).toBe("a1"));
  });

  it("renders mobile menu toggle when onMenuToggle is provided", () => {
    renderChatHeader({ onMenuToggle: mock(() => {}) });
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
  });
});
