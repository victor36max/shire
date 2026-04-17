import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, mock } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw-server";
import { ChatInput } from "../components/chat/ChatInput";
import type { AgentOverview } from "../components/types";
import type { SharedDriveFile } from "../hooks/shared-drive";
import {
  ProjectLayoutContext,
  type ProjectLayoutContextValue,
} from "../providers/ProjectLayoutProvider";
import { renderWithProviders, waitForText } from "../test/test-utils";

const layoutContextValue: ProjectLayoutContextValue = {
  projectId: "p1",
  projectName: "test-project",
  sidebarOpen: false,
  setSidebarOpen: () => {},
  onNewAgent: () => {},
  onBrowseCatalog: () => {},
  panelFilePath: null,
  setPanelFilePath: () => {},
};

const activeAgent: AgentOverview = {
  id: "a1",
  name: "test-agent",
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
    http.get("*/api/projects/:id/shared-drive/search", ({ request }) => {
      const url = new URL(request.url);
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const results = files.filter((f) => f.name.toLowerCase().includes(q));
      return HttpResponse.json({ files: results });
    }),
    http.get("*/api/projects/:id/shared-drive", ({ request }) => {
      const url = new URL(request.url);
      const path = url.searchParams.get("path") ?? "/";
      return HttpResponse.json({ files, currentPath: path });
    }),
  );
}

function renderChatInput() {
  return renderWithProviders(
    <ProjectLayoutContext.Provider value={layoutContextValue}>
      <ChatInput agent={activeAgent} />
    </ProjectLayoutContext.Provider>,
    routeOpts,
  );
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

  it("opens a file in the preview panel when the Open button is clicked (desktop)", async () => {
    // Force desktop mode: useIsDesktop() reads window.matchMedia("(min-width: 768px)").matches.
    // Return a STABLE stub object — useSyncExternalStore calls matchMedia multiple times
    // (subscribe + snapshot) and expects a consistent reference for change notifications.
    const originalMatchMedia = window.matchMedia;
    const desktopMq: MediaQueryList = {
      matches: true,
      media: "(min-width: 768px)",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    window.matchMedia = (() => desktopMq) as unknown as typeof window.matchMedia;

    try {
      setFiles(sampleFiles);
      const setPanelFilePath = mock((_path: string | null) => {});
      const value: ProjectLayoutContextValue = { ...layoutContextValue, setPanelFilePath };
      renderWithProviders(
        <ProjectLayoutContext.Provider value={value}>
          <ChatInput agent={activeAgent} />
        </ProjectLayoutContext.Provider>,
        routeOpts,
      );

      const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;
      await userEvent.type(textarea, "@rea");

      await waitForText("readme.md");

      const openButton = screen.getByRole("button", { name: /open file/i });
      openButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      await waitFor(() => {
        expect(setPanelFilePath).toHaveBeenCalledWith("/readme.md");
      });
      // Textarea value unchanged — no mention was inserted
      expect(textarea.value).toBe("@rea");
      // Dropdown closes
      await waitFor(() => {
        expect(screen.queryByText("readme.md")).toBeNull();
      });
    } finally {
      window.matchMedia = originalMatchMedia;
    }
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
