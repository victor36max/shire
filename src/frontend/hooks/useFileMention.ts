import * as React from "react";
import { useSharedDrive, type SharedDriveFile } from "./shared-drive";

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
  navigateToDirectory: (path: string) => void;
  navigateBack: () => void;
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

export function useFileMention(
  input: string,
  cursorPosition: number,
  projectId: string | undefined,
): FileMentionResult {
  const [currentPath, setCurrentPath] = React.useState("/");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [dismissedAtInput, setDismissedAtInput] = React.useState<string | null>(null);

  const trigger = findTrigger(input, cursorPosition);
  const dismissed = dismissedAtInput !== null && dismissedAtInput === input;

  const isOpen = !dismissed && trigger !== null;
  const query = trigger?.query ?? "";
  const triggerIndex = trigger?.triggerIndex ?? -1;

  const { data, isLoading } = useSharedDrive(isOpen ? projectId : undefined, currentPath);

  const files = data?.files;
  const items = React.useMemo(() => {
    if (!files) return [];
    const q = query.toLowerCase();
    return files
      .filter((f) => f.name.toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [files, query]);

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [query, currentPath]);

  React.useEffect(() => {
    if (!isOpen) {
      setCurrentPath("/");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const navigateUp = React.useCallback(() => {
    setSelectedIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1));
  }, [items.length]);

  const navigateDown = React.useCallback(() => {
    setSelectedIndex((prev) => (prev >= items.length - 1 ? 0 : prev + 1));
  }, [items.length]);

  const dismiss = React.useCallback(() => {
    setDismissedAtInput(input);
    setCurrentPath("/");
  }, [input]);

  const navigateToDirectory = React.useCallback((path: string) => {
    setCurrentPath(path);
  }, []);

  const navigateBack = React.useCallback(() => {
    setCurrentPath((prev) => {
      if (prev === "/") return prev;
      const parent = prev.split("/").slice(0, -1).join("/") || "/";
      return parent;
    });
  }, []);

  const selectItem = React.useCallback(
    (item: SharedDriveFile): string | null => {
      if (item.type === "directory") {
        navigateToDirectory(item.path);
        return null;
      }
      return `/shared${item.path}`;
    },
    [navigateToDirectory],
  );

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
    navigateToDirectory,
    navigateBack,
  };
}
