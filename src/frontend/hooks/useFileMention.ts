import * as React from "react";
import { useSharedDrive, useSharedDriveSearch, type SharedDriveFile } from "./shared-drive";

export interface FileMentionState {
  isOpen: boolean;
  items: SharedDriveFile[];
  selectedIndex: number;
  currentPath: string;
  isLoading: boolean;
  triggerIndex: number;
}

export interface FileMentionActions {
  selectItem: (item: SharedDriveFile) => string | null;
  navigateUp: () => void;
  navigateDown: () => void;
  dismiss: () => void;
}

export type FileMentionResult = FileMentionState & FileMentionActions;

function findTrigger(
  input: string,
  cursorPosition: number,
): { triggerIndex: number; query: string } | null {
  if (cursorPosition === 0) return null;

  let i = cursorPosition - 1;
  while (i >= 0) {
    const ch = input[i];
    if (ch === "@") {
      if (i > 0 && !/\s/.test(input[i - 1])) return null;
      const query = input.slice(i + 1, cursorPosition);
      if (/\s/.test(query)) return null;
      return { triggerIndex: i, query };
    }
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}

/**
 * Parse a query like "docs/sub/file" into a directory path and filter string.
 * "docs/sub/file" → { dirPath: "/docs/sub", filter: "file" }
 * "docs/" → { dirPath: "/docs", filter: "" }
 * "file" → { dirPath: "/", filter: "file" }
 * "" → { dirPath: "/", filter: "" }
 */
function parseQueryPath(query: string): { dirPath: string; filter: string } {
  const slashIndex = query.lastIndexOf("/");
  if (slashIndex === -1) {
    return { dirPath: "/", filter: query };
  }
  const dirPart = query.slice(0, slashIndex);
  const filter = query.slice(slashIndex + 1);
  const dirPath = "/" + dirPart;
  return { dirPath, filter };
}

export function useFileMention(
  input: string,
  cursorPosition: number,
  projectId: string | undefined,
): FileMentionResult {
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [dismissedAtInput, setDismissedAtInput] = React.useState<string | null>(null);
  const [prevFilter, setPrevFilter] = React.useState("");
  const [prevDirPath, setPrevDirPath] = React.useState("/");
  const [prevIsOpen, setPrevIsOpen] = React.useState(false);

  const trigger = findTrigger(input, cursorPosition);
  const dismissed = dismissedAtInput !== null && dismissedAtInput === input;

  const isOpen = !dismissed && trigger !== null;
  const rawQuery = trigger?.query ?? "";
  const triggerIndex = trigger?.triggerIndex ?? -1;

  const hasSlash = rawQuery.includes("/");
  const useSearch = !hasSlash && rawQuery.length > 0;
  const { dirPath, filter } = parseQueryPath(rawQuery);
  const currentPath = isOpen ? dirPath : "/";

  // Use recursive search for non-empty queries without slash, directory listing otherwise
  const searchResult = useSharedDriveSearch(isOpen && useSearch ? projectId : undefined, rawQuery);
  const dirResult = useSharedDrive(isOpen && !useSearch ? projectId : undefined, currentPath);

  const isLoading = useSearch ? searchResult.isLoading : dirResult.isLoading;

  // Reset selectedIndex when filter or path changes
  if (filter !== prevFilter || dirPath !== prevDirPath) {
    setPrevFilter(filter);
    setPrevDirPath(dirPath);
    setSelectedIndex(0);
  }

  // Reset when dropdown closes
  if (!isOpen && prevIsOpen) {
    setPrevIsOpen(false);
    setSelectedIndex(0);
  }
  if (isOpen && !prevIsOpen) {
    setPrevIsOpen(true);
  }

  const searchFiles = searchResult.data?.files;
  const dirFiles = dirResult.data?.files;

  const items = React.useMemo(() => {
    if (useSearch) {
      // Search mode: results already filtered by the backend
      if (!searchFiles) return [];
      return searchFiles.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    }
    // Directory mode: show directory contents, filter by text after last slash
    if (!dirFiles) return [];
    const q = filter.toLowerCase();
    return dirFiles
      .filter((f) => (q ? f.name.toLowerCase().includes(q) : true))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [useSearch, dirFiles, searchFiles, filter]);

  const navigateUp = React.useCallback(() => {
    setSelectedIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1));
  }, [items.length]);

  const navigateDown = React.useCallback(() => {
    setSelectedIndex((prev) => (prev >= items.length - 1 ? 0 : prev + 1));
  }, [items.length]);

  const dismiss = React.useCallback(() => {
    setDismissedAtInput(input);
  }, [input]);

  const selectItem = React.useCallback((item: SharedDriveFile): string | null => {
    if (item.type === "directory") {
      return null;
    }
    return `/shared${item.path}`;
  }, []);

  return {
    isOpen,
    items,
    selectedIndex,
    currentPath,
    isLoading,
    triggerIndex,
    selectItem,
    navigateUp,
    navigateDown,
    dismiss,
  };
}
