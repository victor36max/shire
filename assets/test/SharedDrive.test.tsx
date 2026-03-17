import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import SharedDrive from "../react-components/SharedDrive";
import type { SharedDriveFile } from "../react-components/SharedDrive";

const files: SharedDriveFile[] = [
  { name: "docs", path: "docs", type: "directory", size: 0 },
  { name: "readme.md", path: "readme.md", type: "file", size: 1024 },
  { name: "data.csv", path: "data.csv", type: "file", size: 512000 },
];

describe("SharedDrive", () => {
  it("renders empty state when no files", () => {
    render(<SharedDrive files={[]} current_path="/" pushEvent={vi.fn()} />);
    expect(screen.getByText("This directory is empty")).toBeInTheDocument();
  });

  it("renders the shared drive heading", () => {
    render(<SharedDrive files={[]} current_path="/" pushEvent={vi.fn()} />);
    expect(screen.getByText("Shared Drive")).toBeInTheDocument();
  });

  it("renders files and directories", () => {
    render(<SharedDrive files={files} current_path="/" pushEvent={vi.fn()} />);
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(screen.getByText("data.csv")).toBeInTheDocument();
  });

  it("shows directories before files", () => {
    render(<SharedDrive files={files} current_path="/" pushEvent={vi.fn()} />);
    const rows = screen.getAllByRole("row");
    // Header row + 3 data rows
    expect(rows).toHaveLength(4);
    // First data row should be the directory
    expect(rows[1]).toHaveTextContent("docs");
  });

  it("navigates to directory on click", async () => {
    const pushEvent = vi.fn();
    render(<SharedDrive files={files} current_path="/" pushEvent={pushEvent} />);

    await userEvent.click(screen.getByText("docs"));
    expect(pushEvent).toHaveBeenCalledWith("navigate", { path: "/docs" });
  });

  it("shows download link for files", () => {
    render(<SharedDrive files={files} current_path="/" pushEvent={vi.fn()} />);
    const downloadLinks = screen.getAllByText("Download");
    expect(downloadLinks).toHaveLength(2); // Two files
  });

  it("opens new folder dialog", async () => {
    render(<SharedDrive files={[]} current_path="/" pushEvent={vi.fn()} />);
    await userEvent.click(screen.getByText("New Folder"));
    expect(screen.getByText("Create a new folder in the shared drive.")).toBeInTheDocument();
  });

  it("creates folder via pushEvent", async () => {
    const pushEvent = vi.fn();
    render(<SharedDrive files={[]} current_path="/" pushEvent={pushEvent} />);

    await userEvent.click(screen.getByText("New Folder"));
    await userEvent.type(screen.getByPlaceholderText("Folder name"), "my-folder");
    await userEvent.click(screen.getByText("Create"));

    expect(pushEvent).toHaveBeenCalledWith("create-directory", { name: "my-folder" });
  });

  it("shows delete confirmation for files", async () => {
    render(<SharedDrive files={files} current_path="/" pushEvent={vi.fn()} />);

    const deleteButtons = screen.getAllByText("Delete");
    await userEvent.click(deleteButtons[0]); // Delete the directory

    expect(screen.getByText(/This will permanently delete/)).toBeInTheDocument();
  });

  it("calls delete-file for files", async () => {
    const pushEvent = vi.fn();
    render(
      <SharedDrive
        files={[{ name: "test.txt", path: "test.txt", type: "file", size: 100 }]}
        current_path="/"
        pushEvent={pushEvent}
      />,
    );

    // Click delete on the file row
    await userEvent.click(screen.getByText("Delete"));

    // Confirm in alert dialog
    const confirmDelete = screen.getAllByText("Delete").find((el) => el.closest("[role='alertdialog']"));
    await userEvent.click(confirmDelete!);

    expect(pushEvent).toHaveBeenCalledWith("delete-file", { path: "test.txt" });
  });

  it("renders breadcrumbs for nested path", () => {
    render(<SharedDrive files={[]} current_path="/docs/reports" pushEvent={vi.fn()} />);
    expect(screen.getByText("shared")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("reports")).toBeInTheDocument();
  });

  it("navigates via breadcrumbs", async () => {
    const pushEvent = vi.fn();
    render(<SharedDrive files={[]} current_path="/docs/reports" pushEvent={pushEvent} />);

    await userEvent.click(screen.getByText("shared"));
    expect(pushEvent).toHaveBeenCalledWith("navigate", { path: "/" });
  });
});
