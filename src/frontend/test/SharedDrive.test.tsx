import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import SharedDrive from "../components/SharedDrive";
import type { SharedDriveFile } from "../components/SharedDrive";
import { renderWithProviders } from "./test-utils";
import * as actualHooks from "../hooks";

const createDirMutate = mock(() => {});
const deleteFileMutate = mock(() => {});
const uploadFileMutate = mock(() => {});
const previewFileMutate = mock(
  (
    _path: string,
    _opts: { onSuccess?: (data: unknown) => void; onError?: (err: Error) => void },
  ) => {},
);

let mockFiles: SharedDriveFile[] = [];
let mockSharedDriveError: {
  isError: boolean;
  error: Error | null;
  refetch: ReturnType<typeof mock>;
} = { isError: false, error: null, refetch: mock(() => {}) };

mock.module("../hooks", () => ({
  ...actualHooks,
  useProjectId: () => ({ projectId: "p1", projectName: "test-project" }),
  useSharedDrive: () => ({
    data: { files: mockFiles, currentPath: "/" },
    isLoading: false,
    ...mockSharedDriveError,
  }),
  useCreateDirectory: () => ({ mutate: createDirMutate, isPending: false }),
  useDeleteSharedFile: () => ({ mutate: deleteFileMutate, isPending: false }),
  useUploadSharedDriveFile: () => ({ mutate: uploadFileMutate, isPending: false }),
  usePreviewFile: () => ({
    mutate: previewFileMutate,
    isPending: false,
  }),
}));

const sampleFiles: SharedDriveFile[] = [
  { name: "docs", path: "docs", type: "directory", size: 0 },
  { name: "readme.md", path: "readme.md", type: "file", size: 1024 },
  { name: "data.json", path: "data.json", type: "file", size: 2048 },
];

beforeEach(() => {
  mockFiles = [];
  mockSharedDriveError = { isError: false, error: null, refetch: mock(() => {}) };
  createDirMutate.mockClear();
  deleteFileMutate.mockClear();
  uploadFileMutate.mockClear();
  previewFileMutate.mockClear();
});

describe("SharedDrive", () => {
  it("renders Shared Drive heading", () => {
    renderWithProviders(<SharedDrive />);
    expect(screen.getByRole("heading", { name: "Shared Drive" })).toBeInTheDocument();
  });

  it("shows empty state when no files", () => {
    renderWithProviders(<SharedDrive />);
    expect(screen.getByText("This directory is empty")).toBeInTheDocument();
  });

  it("renders files and directories", () => {
    mockFiles = sampleFiles;
    renderWithProviders(<SharedDrive />);
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(screen.getByText("data.json")).toBeInTheDocument();
  });

  it("sorts directories before files", () => {
    mockFiles = sampleFiles;
    renderWithProviders(<SharedDrive />);
    const cells = screen.getAllByRole("row").slice(1); // skip header row
    expect(cells[0]).toHaveTextContent("docs");
  });

  it("shows breadcrumbs with root", () => {
    renderWithProviders(<SharedDrive />);
    expect(screen.getByRole("button", { name: "shared" })).toBeInTheDocument();
  });

  it("opens new folder dialog", async () => {
    renderWithProviders(<SharedDrive />);
    await userEvent.click(screen.getByRole("button", { name: "New Folder" }));
    expect(screen.getByText("Create a new folder in the shared drive.")).toBeInTheDocument();
  });

  it("creates a folder via dialog", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SharedDrive />);

    await user.click(screen.getByRole("button", { name: "New Folder" }));
    await user.paste("test-folder");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(createDirMutate).toHaveBeenCalledWith({ name: "test-folder", path: "/" });
  });

  it("shows delete confirmation for a file", async () => {
    mockFiles = sampleFiles;
    renderWithProviders(<SharedDrive />);

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    await userEvent.click(deleteButtons[1]);

    expect(screen.getByText(/permanently delete/)).toBeInTheDocument();
  });

  it("shows download button only for files when no preview is open", () => {
    mockFiles = sampleFiles;
    renderWithProviders(<SharedDrive />);
    const downloadLinks = screen.getAllByRole("link", { name: "Download" });
    expect(downloadLinks).toHaveLength(2);
  });

  it("formats file sizes", () => {
    mockFiles = sampleFiles;
    renderWithProviders(<SharedDrive />);
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  describe("file preview", () => {
    it("opens preview panel when clicking a file name", async () => {
      mockFiles = sampleFiles;
      previewFileMutate.mockImplementation(
        (_path: string, opts: { onSuccess?: (data: unknown) => void }) => {
          opts.onSuccess!({ content: "test content", filename: "readme.md", size: 1024 });
        },
      );
      renderWithProviders(<SharedDrive />);

      await userEvent.click(screen.getByText("readme.md"));

      expect(previewFileMutate).toHaveBeenCalledWith("readme.md", expect.any(Object));
    });

    it("shows loading state while fetching text preview", async () => {
      mockFiles = sampleFiles;
      // Never call onSuccess to simulate loading
      previewFileMutate.mockImplementation(() => {});
      renderWithProviders(<SharedDrive />);

      await userEvent.click(screen.getByText("data.json"));

      expect(screen.getByText("Loading preview...")).toBeInTheDocument();
    });

    it("renders markdown content with Preview/Source tabs", async () => {
      mockFiles = sampleFiles;
      previewFileMutate.mockImplementation(
        (_path: string, opts: { onSuccess?: (data: unknown) => void }) => {
          opts.onSuccess!({ content: "# Hello World", filename: "readme.md", size: 1024 });
        },
      );
      renderWithProviders(<SharedDrive />);

      await userEvent.click(screen.getByText("readme.md"));

      expect(screen.getByRole("tab", { name: "Preview" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Source" })).toBeInTheDocument();
    });

    it("closes preview when clicking X button", async () => {
      mockFiles = sampleFiles;
      previewFileMutate.mockImplementation(
        (_path: string, opts: { onSuccess?: (data: unknown) => void }) => {
          opts.onSuccess!({ content: "# Hello", filename: "readme.md", size: 1024 });
        },
      );
      renderWithProviders(<SharedDrive />);

      await userEvent.click(screen.getByText("readme.md"));
      expect(screen.getByText("readme.md", { selector: "span" })).toBeInTheDocument();

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
      mockFiles = sampleFiles;
      previewFileMutate.mockImplementation(
        (_path: string, opts: { onSuccess?: (data: unknown) => void }) => {
          opts.onSuccess!({ content: "test", filename: "data.json", size: 2048 });
        },
      );
      renderWithProviders(<SharedDrive />);

      await userEvent.click(screen.getByText("data.json"));
      expect(screen.getByText("data.json", { selector: "span" })).toBeInTheDocument();

      await userEvent.click(screen.getByText("data.json", { selector: "button" }));
      expect(screen.queryByText("data.json", { selector: "span" })).not.toBeInTheDocument();
    });

    it("shows image preview via img tag for image files", async () => {
      const imageFiles: SharedDriveFile[] = [
        { name: "photo.png", path: "photo.png", type: "file", size: 5000 },
      ];
      mockFiles = imageFiles;
      renderWithProviders(<SharedDrive />);

      await userEvent.click(screen.getByText("photo.png"));

      const img = screen.getByRole("img", { name: "photo.png" });
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute(
        "src",
        "/api/projects/test-project/shared-drive/preview?path=photo.png",
      );
    });

    it("shows unsupported message for unknown file types", async () => {
      const unknownFiles: SharedDriveFile[] = [
        { name: "archive.zip", path: "archive.zip", type: "file", size: 5000 },
      ];
      mockFiles = unknownFiles;
      renderWithProviders(<SharedDrive />);

      await userEvent.click(screen.getByText("archive.zip"));

      expect(screen.getByText("Preview is not available for this file type.")).toBeInTheDocument();
    });

    it("shows error when preview-file returns error", async () => {
      mockFiles = sampleFiles;
      previewFileMutate.mockImplementation(
        (_path: string, opts: { onError?: (err: Error) => void }) => {
          opts.onError!(new Error("File too large to preview"));
        },
      );
      renderWithProviders(<SharedDrive />);

      await userEvent.click(screen.getByText("readme.md"));

      expect(screen.getByText("File too large to preview")).toBeInTheDocument();
    });

    it("shows PDF preview via iframe", async () => {
      const pdfFiles: SharedDriveFile[] = [
        { name: "doc.pdf", path: "doc.pdf", type: "file", size: 10000 },
      ];
      mockFiles = pdfFiles;
      renderWithProviders(<SharedDrive />);

      await userEvent.click(screen.getByText("doc.pdf"));

      const iframe = screen.getByTitle("doc.pdf");
      expect(iframe).toBeInTheDocument();
      expect(iframe).toHaveAttribute(
        "src",
        "/api/projects/test-project/shared-drive/preview?path=doc.pdf",
      );
    });

    it("hides actions column when preview is open", async () => {
      mockFiles = sampleFiles;
      previewFileMutate.mockImplementation(
        (_path: string, opts: { onSuccess?: (data: unknown) => void }) => {
          opts.onSuccess!({ content: "content", filename: "readme.md", size: 1024 });
        },
      );
      renderWithProviders(<SharedDrive />);

      expect(screen.getByText("Actions")).toBeInTheDocument();

      await userEvent.click(screen.getByText("readme.md"));

      expect(screen.queryByText("Actions")).not.toBeInTheDocument();
    });
  });

  it("shows error state with retry when files query fails", () => {
    mockSharedDriveError = {
      isError: true,
      error: new Error("Permission denied"),
      refetch: mock(() => {}),
    };
    renderWithProviders(<SharedDrive />);
    expect(screen.getByText("Permission denied")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
