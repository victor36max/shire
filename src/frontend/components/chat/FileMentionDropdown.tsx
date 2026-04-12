import * as React from "react";
import { FileIcon, FolderIcon, ChevronLeft, Loader2 } from "lucide-react";
import type { SharedDriveFile } from "../../hooks/shared-drive";

interface FileMentionDropdownProps {
  items: SharedDriveFile[];
  selectedIndex: number;
  currentPath: string;
  isLoading: boolean;
  onSelect: (item: SharedDriveFile) => void;
  onNavigateBack: () => void;
}

export function FileMentionDropdown({
  items,
  selectedIndex,
  currentPath,
  isLoading,
  onSelect,
  onNavigateBack,
}: FileMentionDropdownProps) {
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const selected = container.querySelector("[data-selected='true']");
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const showBackButton = currentPath !== "/";

  return (
    <div className="absolute bottom-full left-0 right-0 z-50 mb-1 rounded-md border border-border bg-popover shadow-md">
      {showBackButton && (
        <button
          type="button"
          className="flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
          onMouseDown={(e) => {
            e.preventDefault();
            onNavigateBack();
          }}
        >
          <ChevronLeft className="h-3 w-3" />
          <span className="truncate">{currentPath}</span>
        </button>
      )}
      <div ref={listRef} className="max-h-48 overflow-y-auto py-1">
        {isLoading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isLoading && items.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">No files found</div>
        )}
        {!isLoading &&
          items.map((item, index) => (
            <button
              key={item.path}
              type="button"
              data-selected={index === selectedIndex}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent data-[selected=true]:bg-accent"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item);
              }}
            >
              {item.type === "directory" ? (
                <FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{item.name}</span>
              {currentPath === "/" && item.path !== "/" + item.name && (
                <span className="truncate text-xs text-muted-foreground">
                  {item.path.slice(0, item.path.lastIndexOf("/"))}
                </span>
              )}
            </button>
          ))}
      </div>
    </div>
  );
}
