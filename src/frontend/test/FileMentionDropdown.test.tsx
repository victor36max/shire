import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, mock } from "bun:test";
import { FileMentionDropdown } from "../components/chat/FileMentionDropdown";
import type { SharedDriveFile } from "../hooks/shared-drive";

const sampleFiles: SharedDriveFile[] = [
  { name: "docs", path: "/docs", type: "directory", size: 0 },
  { name: "readme.md", path: "/readme.md", type: "file", size: 1024 },
  { name: "data.csv", path: "/data.csv", type: "file", size: 2048 },
];

function renderDropdown(overrides: Partial<React.ComponentProps<typeof FileMentionDropdown>> = {}) {
  const props = {
    items: sampleFiles,
    selectedIndex: 0,
    currentPath: "/",
    isLoading: false,
    onSelect: mock(() => {}),
    onNavigateBack: mock(() => {}),
    ...overrides,
  };
  return { ...render(<FileMentionDropdown {...props} />), props };
}

describe("FileMentionDropdown", () => {
  it("renders file and directory items", () => {
    renderDropdown();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(screen.getByText("data.csv")).toBeInTheDocument();
  });

  it("shows 'No files found' when items are empty and not loading", () => {
    renderDropdown({ items: [] });
    expect(screen.getByText("No files found")).toBeInTheDocument();
  });

  it("shows loading spinner when isLoading is true", () => {
    const { container } = renderDropdown({ items: [], isLoading: true });
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("does not show back button at root path", () => {
    renderDropdown({ currentPath: "/" });
    expect(screen.queryByRole("button", { name: /\// })).toBeNull();
  });

  it("shows back button when not at root", () => {
    renderDropdown({ currentPath: "/docs" });
    expect(screen.getByText("/docs")).toBeInTheDocument();
  });

  it("marks selected item with data-selected attribute", () => {
    renderDropdown({ selectedIndex: 1 });
    const buttons = screen.getAllByRole("button");
    // First button is "docs" (index 0), second is "readme.md" (index 1)
    expect(buttons[1].dataset.selected).toBe("true");
  });

  it("calls onSelect when an item is clicked via mouseDown", () => {
    const onSelect = mock(() => {});
    renderDropdown({ onSelect });

    const readmeButton = screen.getByText("readme.md").closest("button");
    readmeButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onSelect).toHaveBeenCalledWith(sampleFiles[1]);
  });

  it("calls onNavigateBack when back button is clicked", () => {
    const onNavigateBack = mock(() => {});
    renderDropdown({ currentPath: "/docs", onNavigateBack });

    const backButton = screen.getByText("/docs").closest("button");
    backButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onNavigateBack).toHaveBeenCalled();
  });
});
