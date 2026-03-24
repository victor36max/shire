import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import SharedDrive from "../react-components/SharedDrive";
import type { SharedDriveFile } from "../react-components/SharedDrive";

const defaultProps = {
  project: { id: "p1", name: "test-project" },
  files: [] as SharedDriveFile[],
  current_path: "/",
  pushEvent: vi.fn(),
};

const sampleFiles: SharedDriveFile[] = [
  { name: "docs", path: "docs", type: "directory", size: 0 },
  { name: "readme.md", path: "readme.md", type: "file", size: 1024 },
  { name: "data.json", path: "data.json", type: "file", size: 2048 },
];

describe("SharedDrive", () => {
  it("renders Shared Drive heading", () => {
    render(<SharedDrive {...defaultProps} />);
    expect(screen.getByRole("heading", { name: "Shared Drive" })).toBeInTheDocument();
  });

  it("shows empty state when no files", () => {
    render(<SharedDrive {...defaultProps} />);
    expect(screen.getByText("This directory is empty")).toBeInTheDocument();
  });

  it("renders files and directories", () => {
    render(<SharedDrive {...defaultProps} files={sampleFiles} />);
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(screen.getByText("data.json")).toBeInTheDocument();
  });

  it("sorts directories before files", () => {
    render(<SharedDrive {...defaultProps} files={sampleFiles} />);
    const cells = screen.getAllByRole("row").slice(1); // skip header row
    expect(cells[0]).toHaveTextContent("docs");
  });

  it("navigates when clicking a directory", async () => {
    const pushEvent = vi.fn();
    render(<SharedDrive {...defaultProps} files={sampleFiles} pushEvent={pushEvent} />);

    await userEvent.click(screen.getByText("docs"));
    expect(pushEvent).toHaveBeenCalledWith("navigate", { path: "/docs" });
  });

  it("shows breadcrumbs with root", () => {
    render(<SharedDrive {...defaultProps} />);
    expect(screen.getByRole("button", { name: "shared" })).toBeInTheDocument();
  });

  it("shows nested breadcrumbs", () => {
    render(<SharedDrive {...defaultProps} current_path="/docs/notes" />);
    expect(screen.getByRole("button", { name: "shared" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "docs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "notes" })).toBeInTheDocument();
  });

  it("opens new folder dialog", async () => {
    render(<SharedDrive {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "New Folder" }));
    expect(screen.getByText("Create a new folder in the shared drive.")).toBeInTheDocument();
  });

  it("creates a folder via dialog", async () => {
    const user = userEvent.setup();
    const pushEvent = vi.fn();
    render(<SharedDrive {...defaultProps} pushEvent={pushEvent} />);

    await user.click(screen.getByRole("button", { name: "New Folder" }));
    await user.paste("test-folder");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(pushEvent).toHaveBeenCalledWith("create-directory", { name: "test-folder" });
  });

  it("shows delete confirmation for a file", async () => {
    render(<SharedDrive {...defaultProps} files={sampleFiles} />);

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    await userEvent.click(deleteButtons[1]);

    expect(screen.getByText(/permanently delete/)).toBeInTheDocument();
  });

  it("shows download button only for files when no preview is open", () => {
    render(<SharedDrive {...defaultProps} files={sampleFiles} />);
    const downloadLinks = screen.getAllByRole("link", { name: "Download" });
    expect(downloadLinks).toHaveLength(2);
  });

  it("formats file sizes", () => {
    render(<SharedDrive {...defaultProps} files={sampleFiles} />);
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  describe("file preview", () => {
    it("opens preview panel when clicking a file name", async () => {
      const pushEvent = vi.fn();
      render(<SharedDrive {...defaultProps} files={sampleFiles} pushEvent={pushEvent} />);

      await userEvent.click(screen.getByText("readme.md"));

      expect(pushEvent).toHaveBeenCalledWith("preview-file", { path: "readme.md" }, expect.any(Function));
    });

    it("shows loading state while fetching text preview", async () => {
      const pushEvent = vi.fn();
      render(<SharedDrive {...defaultProps} files={sampleFiles} pushEvent={pushEvent} />);

      await userEvent.click(screen.getByText("data.json"));

      expect(screen.getByText("Loading preview...")).toBeInTheDocument();
    });

    it("renders markdown content with Preview/Source tabs", async () => {
      const pushEvent = vi.fn((_event, _payload, onReply) => {
        if (onReply) onReply({ content: "# Hello World" });
      });
      render(<SharedDrive {...defaultProps} files={sampleFiles} pushEvent={pushEvent} />);

      await userEvent.click(screen.getByText("readme.md"));

      expect(screen.getByRole("tab", { name: "Preview" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Source" })).toBeInTheDocument();
    });

    it("closes preview when clicking X button", async () => {
      const pushEvent = vi.fn((_event, _payload, onReply) => {
        if (onReply) onReply({ content: "# Hello" });
      });
      render(<SharedDrive {...defaultProps} files={sampleFiles} pushEvent={pushEvent} />);

      await userEvent.click(screen.getByText("readme.md"));
      expect(screen.getByText("readme.md", { selector: "span" })).toBeInTheDocument();

      // Find the close button (X icon button)
      const previewPanel = screen.getByText("readme.md", { selector: "span" }).closest("div");
      const closeButton = within(previewPanel!.parentElement!)
        .getAllByRole("button")
        .find((btn) => {
          return btn.querySelector("svg.lucide-x");
        });
      expect(closeButton).toBeDefined();
      await userEvent.click(closeButton!);

      // Preview panel should be gone - no span with the filename in preview header
      expect(screen.queryByText("Loading preview...")).not.toBeInTheDocument();
    });

    it("closes preview when clicking the same file again", async () => {
      const pushEvent = vi.fn((_event, _payload, onReply) => {
        if (onReply) onReply({ content: "test" });
      });
      render(<SharedDrive {...defaultProps} files={sampleFiles} pushEvent={pushEvent} />);

      await userEvent.click(screen.getByText("data.json"));
      // Panel should be open
      expect(screen.getByText("data.json", { selector: "span" })).toBeInTheDocument();

      // Click same file again
      await userEvent.click(screen.getByText("data.json", { selector: "button" }));
      // Preview header span should be gone
      expect(screen.queryByText("data.json", { selector: "span" })).not.toBeInTheDocument();
    });

    it("shows image preview via img tag for image files", async () => {
      const imageFiles: SharedDriveFile[] = [{ name: "photo.png", path: "photo.png", type: "file", size: 5000 }];
      render(<SharedDrive {...defaultProps} files={imageFiles} />);

      await userEvent.click(screen.getByText("photo.png"));

      const img = screen.getByRole("img", { name: "photo.png" });
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", "/projects/test-project/shared/preview?path=photo.png");
    });

    it("shows unsupported message for unknown file types", async () => {
      const unknownFiles: SharedDriveFile[] = [{ name: "archive.zip", path: "archive.zip", type: "file", size: 5000 }];
      render(<SharedDrive {...defaultProps} files={unknownFiles} />);

      await userEvent.click(screen.getByText("archive.zip"));

      expect(screen.getByText("Preview is not available for this file type.")).toBeInTheDocument();
    });

    it("shows error when preview-file returns error", async () => {
      const pushEvent = vi.fn((_event, _payload, onReply) => {
        if (onReply) onReply({ error: "File too large to preview" });
      });
      render(<SharedDrive {...defaultProps} files={sampleFiles} pushEvent={pushEvent} />);

      await userEvent.click(screen.getByText("readme.md"));

      expect(screen.getByText("File too large to preview")).toBeInTheDocument();
    });

    it("shows PDF preview via iframe", async () => {
      const pdfFiles: SharedDriveFile[] = [{ name: "doc.pdf", path: "doc.pdf", type: "file", size: 10000 }];
      render(<SharedDrive {...defaultProps} files={pdfFiles} />);

      await userEvent.click(screen.getByText("doc.pdf"));

      const iframe = screen.getByTitle("doc.pdf");
      expect(iframe).toBeInTheDocument();
      expect(iframe).toHaveAttribute("src", "/projects/test-project/shared/preview?path=doc.pdf");
    });

    it("hides actions column when preview is open", async () => {
      const pushEvent = vi.fn((_event, _payload, onReply) => {
        if (onReply) onReply({ content: "content" });
      });
      render(<SharedDrive {...defaultProps} files={sampleFiles} pushEvent={pushEvent} />);

      // Actions column should be visible before preview
      expect(screen.getByText("Actions")).toBeInTheDocument();

      await userEvent.click(screen.getByText("readme.md"));

      // Actions column should be hidden when preview is open
      expect(screen.queryByText("Actions")).not.toBeInTheDocument();
    });
  });
});
