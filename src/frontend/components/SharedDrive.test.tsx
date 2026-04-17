import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw-server";
import SharedDrivePanel from "../components/sidebar/SharedDrivePanel";
import SharedDriveContentArea from "../components/SharedDriveContentArea";
import { ProjectLayoutProvider } from "../providers/ProjectLayoutProvider";
import type { SharedDriveFile } from "../hooks/shared-drive";
import { renderWithProviders } from "../test/test-utils";

const sampleFiles: SharedDriveFile[] = [
  { name: "docs", path: "docs", type: "directory", size: 0 },
  { name: "readme.md", path: "readme.md", type: "file", size: 1024 },
  { name: "data.json", path: "data.json", type: "file", size: 2048 },
];

const panelRouteOpts = {
  route: "/projects/test-project/shared",
  routePath: "/projects/:projectName/shared",
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

function setPreviewResponse(content: string, filename: string, size: number) {
  server.use(
    http.get("*/api/projects/:id/shared-drive/preview", () =>
      HttpResponse.json({ content, filename, size }),
    ),
  );
}

function renderContentArea(route = "/projects/test-project/shared") {
  return renderWithProviders(
    <ProjectLayoutProvider
      value={{
        projectId: "p1",
        projectName: "test-project",
        sidebarOpen: false,
        setSidebarOpen: () => {},
        onNewAgent: () => {},
        onBrowseCatalog: () => {},
        panelFilePath: null,
        setPanelFilePath: () => {},
      }}
    >
      <SharedDriveContentArea />
    </ProjectLayoutProvider>,
    { route, routePath: "/projects/:projectName/shared" },
  );
}

describe("SharedDrivePanel", () => {
  it("renders breadcrumbs with root", async () => {
    renderWithProviders(<SharedDrivePanel />, panelRouteOpts);
    await waitFor(() => {
      expect(screen.getByText("shared")).toBeInTheDocument();
    });
  });

  it("shows empty state when no files", async () => {
    renderWithProviders(<SharedDrivePanel />, panelRouteOpts);
    await waitFor(() => {
      expect(screen.getByText("Empty directory")).toBeInTheDocument();
    });
  });

  it("renders files and directories", async () => {
    setFiles(sampleFiles);
    renderWithProviders(<SharedDrivePanel />, panelRouteOpts);
    await waitFor(() => {
      expect(screen.getByText("docs")).toBeInTheDocument();
    });
    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(screen.getByText("data.json")).toBeInTheDocument();
  });

  it("sorts directories before files", async () => {
    setFiles(sampleFiles);
    renderWithProviders(<SharedDrivePanel />, panelRouteOpts);
    await waitFor(() => {
      expect(screen.getByText("docs")).toBeInTheDocument();
    });
    const buttons = screen.getAllByRole("button").filter((btn) => {
      const text = btn.textContent ?? "";
      return text === "docs" || text === "readme.md" || text === "data.json";
    });
    expect(buttons[0]).toHaveTextContent("docs");
  });

  it("opens new folder dialog", async () => {
    renderWithProviders(<SharedDrivePanel />, panelRouteOpts);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New Folder" })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "New Folder" }));
    expect(screen.getByText("Create a new folder in the shared drive.")).toBeInTheDocument();
  });

  it("opens new markdown dialog", async () => {
    renderWithProviders(<SharedDrivePanel />, panelRouteOpts);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New Markdown" })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "New Markdown" }));
    expect(screen.getByText("Create a new markdown file in the shared drive.")).toBeInTheDocument();
  });

  it("creates a folder via dialog", async () => {
    let createdDir: Record<string, unknown> | undefined;
    server.use(
      http.post("*/api/projects/:id/shared-drive/directory", async ({ request }) => {
        createdDir = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<SharedDrivePanel />, panelRouteOpts);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New Folder" })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "New Folder" }));
    await user.paste("test-folder");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createdDir).toEqual({ name: "test-folder", path: "/" });
    });
  });

  it("creates folder via Enter key in dialog", async () => {
    let createdDir: Record<string, unknown> | undefined;
    server.use(
      http.post("*/api/projects/:id/shared-drive/directory", async ({ request }) => {
        createdDir = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<SharedDrivePanel />, panelRouteOpts);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New Folder" })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "New Folder" }));
    await user.paste("enter-folder");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(createdDir).toEqual({ name: "enter-folder", path: "/" });
    });
  });

  it("navigates into a subdirectory", async () => {
    setFiles(sampleFiles);
    renderWithProviders(<SharedDrivePanel />, panelRouteOpts);

    await waitFor(() => {
      expect(screen.getByText("docs")).toBeInTheDocument();
    });

    server.use(
      http.get("*/api/projects/:id/shared-drive", ({ request }) => {
        const url = new URL(request.url);
        const path = url.searchParams.get("path") ?? "/";
        if (path.includes("docs")) {
          return HttpResponse.json({
            files: [{ name: "notes.txt", path: "docs/notes.txt", type: "file", size: 512 }],
            currentPath: "/docs",
          });
        }
        return HttpResponse.json({ files: sampleFiles, currentPath: path });
      }),
    );

    await userEvent.click(screen.getByText("docs"));

    await waitFor(() => {
      expect(screen.getByText("notes.txt")).toBeInTheDocument();
    });
  });

  it("navigates to parent folder when file search param is set", async () => {
    const nestedFiles: SharedDriveFile[] = [
      { name: "notes.txt", path: "/docs/sub/notes.txt", type: "file", size: 512 },
      { name: "readme.md", path: "/docs/sub/readme.md", type: "file", size: 1024 },
    ];
    server.use(
      http.get("*/api/projects/:id/shared-drive", ({ request }) => {
        const url = new URL(request.url);
        const path = url.searchParams.get("path") ?? "/";
        if (path === "/docs/sub") {
          return HttpResponse.json({ files: nestedFiles, currentPath: "/docs/sub" });
        }
        return HttpResponse.json({ files: [], currentPath: path });
      }),
    );

    renderWithProviders(<SharedDrivePanel />, {
      route: "/projects/test-project/shared?file=/docs/sub/notes.txt",
      routePath: "/projects/:projectName/shared",
    });

    // Should show breadcrumbs for /docs/sub
    await waitFor(() => {
      expect(screen.getByText("docs")).toBeInTheDocument();
      expect(screen.getByText("sub")).toBeInTheDocument();
    });

    // Should show files from the /docs/sub directory
    await waitFor(() => {
      expect(screen.getByText("notes.txt")).toBeInTheDocument();
    });
  });

  it("has upload button", async () => {
    renderWithProviders(<SharedDrivePanel />, panelRouteOpts);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Upload File" })).toBeInTheDocument();
    });
  });

  it("opens rename dialog from dropdown menu", async () => {
    setFiles(sampleFiles);
    renderWithProviders(<SharedDrivePanel />, panelRouteOpts);
    await waitFor(() => {
      expect(screen.getByText("readme.md")).toBeInTheDocument();
    });

    // Open dropdown for readme.md
    const actionButtons = screen.getAllByRole("button", { name: /actions/ });
    await userEvent.click(actionButtons[1]); // second file (first is docs folder)

    await userEvent.click(screen.getByText("Rename"));
    expect(screen.getByText(/Enter a new name/)).toBeInTheDocument();
  });

  it("renames a file via dialog", async () => {
    let renamePayload: Record<string, unknown> | undefined;
    server.use(
      http.patch("*/api/projects/:id/shared-drive/rename", async ({ request }) => {
        renamePayload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, newPath: "/new-name.md" });
      }),
    );
    setFiles(sampleFiles);
    const user = userEvent.setup();
    renderWithProviders(<SharedDrivePanel />, panelRouteOpts);
    await waitFor(() => {
      expect(screen.getByText("readme.md")).toBeInTheDocument();
    });

    const actionButtons = screen.getAllByRole("button", { name: /actions/ });
    await user.click(actionButtons[1]);
    await user.click(screen.getByText("Rename"));

    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "new-name.md");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => {
      expect(renamePayload).toEqual({ path: "data.json", newName: "new-name.md" });
    });
  });

  it("uploads files via hidden input", async () => {
    renderWithProviders(<SharedDrivePanel />, panelRouteOpts);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Upload File" })).toBeInTheDocument();
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const file = new File([new Uint8Array(10)], "test.txt", { type: "text/plain" });
    const dt = new DataTransfer();
    dt.items.add(file);
    Object.defineProperty(input, "files", { value: dt.files, configurable: true });
    fireEvent.change(input);

    // Upload should complete (MSW handles it)
    await waitFor(() => {
      const progressBar = document.querySelector(".bg-primary.transition-all");
      expect(progressBar).not.toBeInTheDocument();
    });
  });
});

describe("SharedDriveContentArea", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows empty state when no file selected", async () => {
    renderContentArea();
    await waitFor(() => {
      expect(
        screen.getByText("Select a file from the sidebar to preview or edit it."),
      ).toBeInTheDocument();
    });
  });

  it("renders markdown file in the rich text editor", async () => {
    setPreviewResponse("# Hello World", "readme.md", 1024);
    renderContentArea("/projects/test-project/shared?file=readme.md");
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
  });

  it("shows save status indicator for markdown editor", async () => {
    setPreviewResponse("# Hello World", "readme.md", 1024);
    renderContentArea("/projects/test-project/shared?file=readme.md");
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("shows image preview via img tag using download endpoint", async () => {
    renderContentArea("/projects/test-project/shared?file=photo.png");
    await waitFor(() => {
      const img = screen.getByRole("img", { name: "photo.png" });
      expect(img).toBeInTheDocument();
      expect(img.getAttribute("src")).toMatch(/^blob:/);
    });
  });

  it("shows unsupported message for unknown file types", async () => {
    renderContentArea("/projects/test-project/shared?file=archive.zip");
    await waitFor(() => {
      expect(screen.getByText("Preview is not available for this file type.")).toBeInTheDocument();
    });
  });

  it("shows error when preview returns error", async () => {
    server.use(
      http.get("*/api/projects/:id/shared-drive/preview", () =>
        HttpResponse.json({ error: "File too large to preview" }, { status: 500 }),
      ),
    );
    renderContentArea("/projects/test-project/shared?file=readme.md");
    await waitFor(() => {
      expect(screen.getByText(/File too large to preview|Failed to load file/)).toBeInTheDocument();
    });
  });

  it("renders text file in CodeEditor", async () => {
    setPreviewResponse('{"key": "value"}', "data.json", 2048);
    renderContentArea("/projects/test-project/shared?file=data.json");
    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });
    // CodeMirror renders a contenteditable div, not a textarea
    const cmContent = document.querySelector(".cm-content");
    expect(cmContent).toBeInTheDocument();
  });

  it("shows file name in header", async () => {
    renderContentArea("/projects/test-project/shared?file=photo.png");
    await waitFor(() => {
      expect(screen.getByText("photo.png")).toBeInTheDocument();
    });
  });

  it("shows download button for selected file", async () => {
    renderContentArea("/projects/test-project/shared?file=photo.png");
    await waitFor(() => {
      const button = screen.getByRole("button", { name: "Download" });
      expect(button).toBeInTheDocument();
    });
  });

  it("shows delete confirmation dialog", async () => {
    renderContentArea("/projects/test-project/shared?file=readme.md");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/permanently delete/)).toBeInTheDocument();
  });

  it("sends delete request and clears file param", async () => {
    let deletedPath: string | undefined;
    server.use(
      http.delete("*/api/projects/:id/shared-drive", ({ request }) => {
        const url = new URL(request.url);
        deletedPath = url.searchParams.get("path") ?? undefined;
        return HttpResponse.json({ ok: true });
      }),
    );
    renderContentArea("/projects/test-project/shared?file=readme.md");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog");
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent === "Delete",
    );
    await userEvent.click(confirmBtn!);
    await waitFor(() => expect(deletedPath).toBe("readme.md"));
  });

  it("shows loading spinner while fetching text content", async () => {
    server.use(http.get("*/api/projects/:id/shared-drive/preview", () => new Promise(() => {})));
    renderContentArea("/projects/test-project/shared?file=data.json");
    await waitFor(() => {
      expect(document.querySelector(".animate-spin")).toBeInTheDocument();
    });
  });

  it("shows menu toggle button for mobile sidebar", async () => {
    renderContentArea("/projects/test-project/shared?file=photo.png");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
    });
  });

  it("uploads files via drag-and-drop", async () => {
    renderContentArea("/projects/test-project/shared?file=readme.md");
    await waitFor(() => {
      expect(screen.getByText("readme.md")).toBeInTheDocument();
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const file = new File([new Uint8Array(10)], "upload.txt", { type: "text/plain" });
    const dt = new DataTransfer();
    dt.items.add(file);
    Object.defineProperty(input, "files", { value: dt.files, configurable: true });
    fireEvent.change(input);

    await waitFor(() => {
      const progressBar = document.querySelector(".bg-primary.transition-all");
      expect(progressBar).not.toBeInTheDocument();
    });
  });

  it("shows error for oversized files in content area", async () => {
    renderContentArea("/projects/test-project/shared?file=readme.md");
    await waitFor(() => {
      expect(screen.getByText("readme.md")).toBeInTheDocument();
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const oversized = new File([new Uint8Array(129 * 1024 * 1024)], "huge.bin", {
      type: "application/octet-stream",
    });
    const dt = new DataTransfer();
    dt.items.add(oversized);
    Object.defineProperty(input, "files", { value: dt.files, configurable: true });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByText(/too large/)).toBeInTheDocument();
    });
  });

  it("saves selected file to localStorage", async () => {
    renderContentArea("/projects/test-project/shared?file=readme.md");
    await waitFor(() => {
      expect(localStorage.getItem("shire:file:test-project")).toBe("readme.md");
    });
  });

  it("restores file from localStorage when no URL param", async () => {
    localStorage.setItem("shire:file:test-project", "photo.png");
    renderContentArea("/projects/test-project/shared");
    await waitFor(() => {
      const img = screen.getByRole("img", { name: "photo.png" });
      expect(img).toBeInTheDocument();
    });
  });

  it("clears localStorage on file delete", async () => {
    server.use(
      http.delete("*/api/projects/:id/shared-drive", () => HttpResponse.json({ ok: true })),
    );
    renderContentArea("/projects/test-project/shared?file=readme.md");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog");
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent === "Delete",
    );
    await userEvent.click(confirmBtn!);
    await waitFor(() => {
      expect(localStorage.getItem("shire:file:test-project")).toBeNull();
    });
  });
});
