import { describe, it, expect, mock } from "bun:test";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import { ProjectLayoutProvider } from "../providers/ProjectLayoutProvider";
import FilePreviewPanel from "../components/FilePreviewPanel";
import { renderWithProviders } from "./test-utils";

mock.module("../lib/ws", () => ({
  useSubscription: mock(() => {}),
}));

function setPreview(content: string, filename: string) {
  server.use(
    http.get("*/api/projects/:id/shared-drive/preview", () =>
      HttpResponse.json({ content, filename, size: content.length }),
    ),
  );
}

const layoutValue = {
  projectId: "p1",
  projectName: "test-project",
  sidebarOpen: false,
  setSidebarOpen: () => {},
  onNewAgent: () => {},
  onBrowseCatalog: () => {},
  panelFilePath: "/readme.md",
  setPanelFilePath: () => {},
};

function renderPanel(props?: { onClose?: () => void; onExpand?: () => void; filePath?: string }) {
  const onClose = props?.onClose ?? mock(() => {});
  const onExpand = props?.onExpand ?? mock(() => {});
  const filePath = props?.filePath ?? "/readme.md";

  return renderWithProviders(
    <ProjectLayoutProvider value={layoutValue}>
      <FilePreviewPanel
        projectId="p1"
        projectName="test-project"
        filePath={filePath}
        onClose={onClose}
        onExpand={onExpand}
      />
    </ProjectLayoutProvider>,
    {
      route: "/projects/test-project/agents/my-agent",
      routePath: "/projects/:projectName/agents/:agentName",
    },
  );
}

describe("FilePreviewPanel", () => {
  it("renders file name in header", () => {
    setPreview("# Hello", "readme.md");
    renderPanel();
    expect(screen.getByText("readme.md")).toBeInTheDocument();
  });

  it("renders close and expand buttons", () => {
    setPreview("# Hello", "readme.md");
    renderPanel();
    expect(screen.getByLabelText("Close panel")).toBeInTheDocument();
    expect(screen.getByLabelText("Expand to full view")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    setPreview("# Hello", "readme.md");
    const onClose = mock(() => {});
    renderPanel({ onClose });
    await userEvent.click(screen.getByLabelText("Close panel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onExpand when expand button is clicked", async () => {
    setPreview("# Hello", "readme.md");
    const onExpand = mock(() => {});
    renderPanel({ onExpand });
    await userEvent.click(screen.getByLabelText("Expand to full view"));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("shows unsupported message for unknown file types", async () => {
    renderPanel({ filePath: "/archive.tar.gz" });
    await waitFor(() => {
      expect(screen.getByText("Preview is not available for this file type.")).toBeInTheDocument();
    });
  });

  it("renders image preview for image files", async () => {
    renderPanel({ filePath: "/photo.png" });
    await waitFor(() => {
      const img = screen.getByRole("img");
      expect(img).toBeInTheDocument();
      expect(img.getAttribute("alt")).toBe("photo.png");
    });
  });

  it("shows loading spinner while fetching content", () => {
    server.use(http.get("*/api/projects/:id/shared-drive/preview", () => new Promise(() => {})));
    renderPanel();
    // Spinner renders an SVG with animate-spin class
    const svg = document.querySelector(".animate-spin");
    expect(svg).not.toBeNull();
  });
});
