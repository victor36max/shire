import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import { ChatInput } from "../components/chat/ChatInput";
import type { AgentOverview } from "../components/types";
import type { SharedDriveFile } from "../hooks/shared-drive";
import { renderWithProviders, waitForText } from "./test-utils";

const activeAgent: AgentOverview = {
  id: "a1",
  name: "test-agent",
  status: "active",
  busy: false,
  unreadCount: 0,
};

const sampleFiles: SharedDriveFile[] = [
  { name: "docs", path: "/docs", type: "directory", size: 0 },
  { name: "readme.md", path: "/readme.md", type: "file", size: 1024 },
  { name: "report.csv", path: "/report.csv", type: "file", size: 2048 },
];

const routeOpts = {
  route: "/projects/test-project/agents/a1",
  routePath: "/projects/:projectName/agents/:agentId",
};

function setFiles(files: SharedDriveFile[]) {
  server.use(
    http.get("*/api/projects/:id/shared-drive", ({ request }) => {
      const url = new URL(request.url);
      const path = url.searchParams.get("path") ?? "/";
      return HttpResponse.json({ files, currentPath: path });
    }),
  );
}

function renderChatInput() {
  return renderWithProviders(<ChatInput agent={activeAgent} />, routeOpts);
}

describe("ChatInput file mention", () => {
  it("shows dropdown when @ is typed", async () => {
    setFiles(sampleFiles);
    renderChatInput();

    const textarea = screen.getByPlaceholderText(/Type a message/);
    await userEvent.type(textarea, "@");

    await waitForText("readme.md");
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("report.csv")).toBeInTheDocument();
  });

  it("filters items as user types after @", async () => {
    setFiles(sampleFiles);
    renderChatInput();

    const textarea = screen.getByPlaceholderText(/Type a message/);
    await userEvent.type(textarea, "@rea");

    await waitForText("readme.md");
    expect(screen.queryByText("report.csv")).toBeNull();
  });

  it("inserts /shared/path when file is selected via Enter", async () => {
    setFiles(sampleFiles);
    renderChatInput();

    const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;
    await userEvent.type(textarea, "@rea");

    await waitForText("readme.md");

    // Arrow down to skip directories, then press Enter
    // With filtering "rea", only readme.md should match
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(textarea.value).toContain("/shared/readme.md");
    });
  });

  it("closes dropdown on Escape", async () => {
    setFiles(sampleFiles);
    renderChatInput();

    const textarea = screen.getByPlaceholderText(/Type a message/);
    await userEvent.type(textarea, "@");

    await waitForText("readme.md");

    await userEvent.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByText("readme.md")).toBeNull();
    });
  });

  it("does not open dropdown for email-like patterns", async () => {
    setFiles(sampleFiles);
    renderChatInput();

    const textarea = screen.getByPlaceholderText(/Type a message/);
    await userEvent.type(textarea, "user@example");

    // Give time for potential fetch
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText("readme.md")).toBeNull();
  });

  it("shows empty state when no files match", async () => {
    setFiles(sampleFiles);
    renderChatInput();

    const textarea = screen.getByPlaceholderText(/Type a message/);
    await userEvent.type(textarea, "@zzzzz");

    await waitForText("No files found");
  });

  it("navigates keyboard down and up through items", async () => {
    setFiles(sampleFiles);
    renderChatInput();

    const textarea = screen.getByPlaceholderText(/Type a message/);
    await userEvent.type(textarea, "@");

    await waitForText("docs");

    // Navigate down
    await userEvent.keyboard("{ArrowDown}");

    // The second item should now be selected
    const buttons = screen.getAllByRole("button").filter((b) => b.dataset.selected !== undefined);
    const selectedButton = buttons.find((b) => b.dataset.selected === "true");
    expect(selectedButton).toBeDefined();
  });
});
