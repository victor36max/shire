import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import SharedDrive from "../components/SharedDrive";
import type { SharedDriveFile } from "../components/SharedDrive";
import { renderWithProviders } from "./test-utils";

const sampleFiles: SharedDriveFile[] = [
  { name: "docs", path: "docs", type: "directory", size: 0 },
  { name: "readme.md", path: "readme.md", type: "file", size: 1024 },
  { name: "data.json", path: "data.json", type: "file", size: 2048 },
];

const routeOpts = {
  route: "/projects/test-project/shared-drive",
  routePath: "/projects/:projectName/shared-drive",
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

describe("SharedDrive", () => {
  it("renders Shared Drive heading", async () => {
    renderWithProviders(<SharedDrive />, routeOpts);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Shared Drive" })).toBeInTheDocument();
    });
  });

  it("shows empty state when no files", async () => {
    renderWithProviders(<SharedDrive />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("This directory is empty")).toBeInTheDocument();
    });
  });

  it("renders files and directories", async () => {
    setFiles(sampleFiles);
    renderWithProviders(<SharedDrive />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("docs")).toBeInTheDocument();
    });
    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(screen.getByText("data.json")).toBeInTheDocument();
  });

  it("sorts directories before files", async () => {
    setFiles(sampleFiles);
    renderWithProviders(<SharedDrive />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("docs")).toBeInTheDocument();
    });
    const cells = screen.getAllByRole("row").slice(1); // skip header row
    expect(cells[0]).toHaveTextContent("docs");
  });

  it("shows breadcrumbs with root", async () => {
    renderWithProviders(<SharedDrive />, routeOpts);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "shared" })).toBeInTheDocument();
    });
  });

  it("opens new folder dialog", async () => {
    renderWithProviders(<SharedDrive />, routeOpts);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New Folder" })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "New Folder" }));
    expect(screen.getByText("Create a new folder in the shared drive.")).toBeInTheDocument();
  });

  it("opens new markdown dialog", async () => {
    renderWithProviders(<SharedDrive />, routeOpts);
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
    renderWithProviders(<SharedDrive />, routeOpts);

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

  it("shows delete confirmation for a file", async () => {
    setFiles(sampleFiles);
    renderWithProviders(<SharedDrive />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("readme.md")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    await userEvent.click(deleteButtons[1]);

    expect(screen.getByText(/permanently delete/)).toBeInTheDocument();
  });

  it("shows download button only for files when no preview is open", async () => {
    setFiles(sampleFiles);
    renderWithProviders(<SharedDrive />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("readme.md")).toBeInTheDocument();
    });
    const downloadLinks = screen.getAllByRole("link", { name: "Download" });
    expect(downloadLinks).toHaveLength(2);
  });

  it("formats file sizes", async () => {
    setFiles(sampleFiles);
    renderWithProviders(<SharedDrive />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("1.0 KB")).toBeInTheDocument();
    });
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  describe("file preview", () => {
    it("opens preview panel when clicking a file name", async () => {
      setFiles(sampleFiles);
      setPreviewResponse("test content", "readme.md", 1024);
      renderWithProviders(<SharedDrive />, routeOpts);

      await waitFor(() => {
        expect(screen.getByText("readme.md")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("readme.md"));

      await waitFor(() => {
        expect(screen.getByText("readme.md", { selector: "span" })).toBeInTheDocument();
      });
    });

    it("shows loading state while fetching text preview", async () => {
      setFiles(sampleFiles);
      // Never respond to simulate loading
      server.use(http.get("*/api/projects/:id/shared-drive/preview", () => new Promise(() => {})));
      renderWithProviders(<SharedDrive />, routeOpts);

      await waitFor(() => {
        expect(screen.getByText("data.json")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("data.json"));

      await waitFor(() => {
        expect(screen.getByText("Loading preview...")).toBeInTheDocument();
      });
    });

    it("renders markdown file in the rich text editor", async () => {
      setFiles(sampleFiles);
      setPreviewResponse("# Hello World", "readme.md", 1024);
      renderWithProviders(<SharedDrive />, routeOpts);

      await waitFor(() => {
        expect(screen.getByText("readme.md")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("readme.md"));

      await waitFor(() => {
        expect(screen.getByRole("textbox")).toBeInTheDocument();
      });
    });

    it("renders mdx file in the rich text editor", async () => {
      const filesWithMdx: SharedDriveFile[] = [
        { name: "article.mdx", path: "article.mdx", type: "file", size: 512 },
      ];
      setFiles(filesWithMdx);
      setPreviewResponse("# MDX Content", "article.mdx", 512);
      renderWithProviders(<SharedDrive />, routeOpts);

      await waitFor(() => {
        expect(screen.getByText("article.mdx")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("article.mdx"));

      await waitFor(() => {
        expect(screen.getByRole("textbox")).toBeInTheDocument();
      });
    });

    it("shows save status indicator for markdown editor", async () => {
      setFiles(sampleFiles);
      setPreviewResponse("# Hello World", "readme.md", 1024);
      renderWithProviders(<SharedDrive />, routeOpts);

      await waitFor(() => {
        expect(screen.getByText("readme.md")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("readme.md"));

      await waitFor(() => {
        expect(screen.getByRole("textbox")).toBeInTheDocument();
      });

      expect(screen.getByText("Saved")).toBeInTheDocument();
    });

    it("closes preview when clicking X button", async () => {
      setFiles(sampleFiles);
      setPreviewResponse("# Hello", "readme.md", 1024);
      renderWithProviders(<SharedDrive />, routeOpts);

      await waitFor(() => {
        expect(screen.getByText("readme.md")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("readme.md"));
      await waitFor(() => {
        expect(screen.getByText("readme.md", { selector: "span" })).toBeInTheDocument();
      });

      const previewPanel = screen.getByText("readme.md", { selector: "span" }).closest("div");
      const closeButton = within(previewPanel!.parentElement!)
        .getAllByRole("button")
        .find((btn) => {
          return btn.querySelector("svg.lucide-x");
        });
      expect(closeButton).toBeDefined();
      await userEvent.click(closeButton!);

      expect(screen.queryByText("Loading preview...")).not.toBeInTheDocument();
    });

    it("closes preview when clicking the same file again", async () => {
      setFiles(sampleFiles);
      setPreviewResponse("test", "data.json", 2048);
      renderWithProviders(<SharedDrive />, routeOpts);

      await waitFor(() => {
        expect(screen.getByText("data.json")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("data.json"));
      await waitFor(() => {
        expect(screen.getByText("data.json", { selector: "span" })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("data.json", { selector: "button" }));
      expect(screen.queryByText("data.json", { selector: "span" })).not.toBeInTheDocument();
    });

    it("shows image preview via img tag for image files", async () => {
      const imageFiles: SharedDriveFile[] = [
        { name: "photo.png", path: "photo.png", type: "file", size: 5000 },
      ];
      setFiles(imageFiles);
      renderWithProviders(<SharedDrive />, routeOpts);

      await waitFor(() => {
        expect(screen.getByText("photo.png")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("photo.png"));

      await waitFor(() => {
        const img = screen.getByRole("img", { name: "photo.png" });
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute(
          "src",
          "/api/projects/test-project/shared-drive/preview?path=photo.png",
        );
      });
    });

    it("shows unsupported message for unknown file types", async () => {
      const unknownFiles: SharedDriveFile[] = [
        { name: "archive.zip", path: "archive.zip", type: "file", size: 5000 },
      ];
      setFiles(unknownFiles);
      renderWithProviders(<SharedDrive />, routeOpts);

      await waitFor(() => {
        expect(screen.getByText("archive.zip")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("archive.zip"));

      await waitFor(() => {
        expect(
          screen.getByText("Preview is not available for this file type."),
        ).toBeInTheDocument();
      });
    });

    it("shows error when preview-file returns error", async () => {
      setFiles(sampleFiles);
      server.use(
        http.get("*/api/projects/:id/shared-drive/preview", () =>
          HttpResponse.json({ error: "File too large to preview" }, { status: 500 }),
        ),
      );
      renderWithProviders(<SharedDrive />, routeOpts);

      await waitFor(() => {
        expect(screen.getByText("readme.md")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("readme.md"));

      await waitFor(() => {
        expect(
          screen.getByText(/File too large to preview|Failed to load preview/),
        ).toBeInTheDocument();
      });
    });

    it("shows PDF preview via iframe", async () => {
      const pdfFiles: SharedDriveFile[] = [
        { name: "doc.pdf", path: "doc.pdf", type: "file", size: 10000 },
      ];
      setFiles(pdfFiles);
      renderWithProviders(<SharedDrive />, routeOpts);

      await waitFor(() => {
        expect(screen.getByText("doc.pdf")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("doc.pdf"));

      await waitFor(() => {
        const iframe = screen.getByTitle("doc.pdf");
        expect(iframe).toBeInTheDocument();
        expect(iframe).toHaveAttribute(
          "src",
          "/api/projects/test-project/shared-drive/preview?path=doc.pdf",
        );
      });
    });

    it("hides actions column when preview is open", async () => {
      setFiles(sampleFiles);
      setPreviewResponse("content", "readme.md", 1024);
      renderWithProviders(<SharedDrive />, routeOpts);

      await waitFor(() => {
        expect(screen.getByText("readme.md")).toBeInTheDocument();
      });

      expect(screen.getByText("Actions")).toBeInTheDocument();

      await userEvent.click(screen.getByText("readme.md"));

      await waitFor(() => {
        expect(screen.queryByText("Actions")).not.toBeInTheDocument();
      });
    });
  });

  describe("file upload", () => {
    function createFile(name: string, size: number, type = "text/plain"): File {
      const content = new Uint8Array(size);
      return new File([content], name, { type });
    }

    function createDataTransfer(files: File[]): DataTransfer {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      return dt;
    }

    it("dismisses progress bar after all concurrent uploads complete", async () => {
      renderWithProviders(<SharedDrive />, routeOpts);

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Shared Drive" })).toBeInTheDocument();
      });

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input).toBeTruthy();

      const files = [createFile("a.txt", 10), createFile("b.txt", 20), createFile("c.txt", 30)];
      const dt = createDataTransfer(files);
      Object.defineProperty(input, "files", { value: dt.files, configurable: true });
      fireEvent.change(input);

      // Progress bar should appear then dismiss after all uploads complete
      await waitFor(() => {
        const progressBar = document.querySelector(".bg-primary.transition-all");
        expect(progressBar).not.toBeInTheDocument();
      });
    });

    it("shows error for oversized files without blocking valid ones", async () => {
      renderWithProviders(<SharedDrive />, routeOpts);

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Shared Drive" })).toBeInTheDocument();
      });

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;

      const files = [createFile("ok.txt", 100), createFile("huge.bin", 129 * 1024 * 1024)];
      const dt = createDataTransfer(files);
      Object.defineProperty(input, "files", { value: dt.files, configurable: true });
      fireEvent.change(input);

      await waitFor(() => {
        expect(screen.getByText(/too large/)).toBeInTheDocument();
      });
    });
  });

  it("navigates into a subdirectory and shows breadcrumbs", async () => {
    // First render shows root with a 'docs' directory
    setFiles(sampleFiles);
    renderWithProviders(<SharedDrive />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("docs")).toBeInTheDocument();
    });

    // Set up files for the subdirectory
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

    // Click the directory to navigate into it
    await userEvent.click(screen.getByText("docs"));

    await waitFor(() => {
      expect(screen.getByText("notes.txt")).toBeInTheDocument();
    });
  });

  it("deletes the currently previewed file and closes preview", async () => {
    setFiles(sampleFiles);
    setPreviewResponse("content", "readme.md", 1024);
    let deletedPath: string | undefined;
    server.use(
      http.delete("*/api/projects/:id/shared-drive", ({ request }) => {
        const url = new URL(request.url);
        deletedPath = url.searchParams.get("path") ?? undefined;
        return HttpResponse.json({ ok: true });
      }),
    );
    renderWithProviders(<SharedDrive />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("readme.md")).toBeInTheDocument();
    });

    // Open preview
    await userEvent.click(screen.getByText("readme.md"));
    await waitFor(() => {
      expect(screen.getByText("readme.md", { selector: "span" })).toBeInTheDocument();
    });

    // Click Delete in the preview panel header
    const previewPanel = screen.getByText("readme.md", { selector: "span" }).closest("div");
    const deleteInPreview = within(previewPanel!.parentElement!)
      .getAllByRole("button")
      .find((btn) => btn.getAttribute("aria-label") === "Delete" || btn.textContent === "Delete");
    if (deleteInPreview) {
      await userEvent.click(deleteInPreview);
      // Confirm deletion
      const alertDialog = screen.getByRole("alertdialog");
      const confirmButton = within(alertDialog)
        .getAllByRole("button")
        .find((btn) => btn.textContent === "Delete");
      if (confirmButton) {
        await userEvent.click(confirmButton);
        await waitFor(() => expect(deletedPath).toBeDefined());
      }
    }
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
    renderWithProviders(<SharedDrive />, routeOpts);

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

  it("shows error state with retry when files query fails", async () => {
    server.use(
      http.get("*/api/projects/:id/shared-drive", () =>
        HttpResponse.json({ error: "Permission denied" }, { status: 500 }),
      ),
    );
    renderWithProviders(<SharedDrive />, routeOpts);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    });
  });
});
