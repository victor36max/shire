import { render, screen } from "@testing-library/react";
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
    // Click delete on a file (not directory)
    await userEvent.click(deleteButtons[1]);

    expect(screen.getByText(/permanently delete/)).toBeInTheDocument();
  });

  it("shows download button only for files", () => {
    render(<SharedDrive {...defaultProps} files={sampleFiles} />);
    const downloadLinks = screen.getAllByRole("link", { name: "Download" });
    // Only files get download links (2 files, no directory)
    expect(downloadLinks).toHaveLength(2);
  });

  it("formats file sizes", () => {
    render(<SharedDrive {...defaultProps} files={sampleFiles} />);
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });
});
