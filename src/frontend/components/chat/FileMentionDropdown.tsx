import * as React from "react";
import { FolderIcon, ChevronLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { SharedDriveFile } from "../../hooks/shared-drive";
import { getFileIcon } from "../../lib/file-utils";

interface FileMentionDropdownProps {
  items: SharedDriveFile[];
  selectedIndex: number;
  currentPath: string;
  isLoading: boolean;
  onSelect: (item: SharedDriveFile) => void;
  onNavigateBack: () => void;
  onPreview?: (item: SharedDriveFile) => void;
}

export function FileMentionDropdown({
  items,
  selectedIndex,
  currentPath,
  isLoading,
  onSelect,
  onNavigateBack,
  onPreview,
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
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="w-full justify-start rounded-none border-b border-border px-3 py-1.5 text-muted-foreground"
          onMouseDown={(e) => {
            e.preventDefault();
            onNavigateBack();
          }}
        >
          <ChevronLeft />
          <span className="truncate">{currentPath}</span>
        </Button>
      )}
      <div ref={listRef} className="max-h-48 overflow-y-auto py-1">
        {isLoading && (
          <div className="flex items-center justify-center py-4">
            <Spinner size="sm" className="text-muted-foreground" />
          </div>
        )}
        {!isLoading && items.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">No files found</div>
        )}
        {!isLoading &&
          items.map((item, index) => {
            const ItemIcon = item.type === "directory" ? FolderIcon : getFileIcon(item.name);
            const isSelected = index === selectedIndex;
            const isFile = item.type === "file";
            return (
              <div key={item.path} className="flex items-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-selected={isSelected}
                  className="min-w-0 flex-1 justify-start rounded-none px-3 py-1.5 text-sm data-[selected=true]:bg-accent"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(item);
                  }}
                >
                  <ItemIcon className="text-muted-foreground" />
                  <span className="truncate">{item.name}</span>
                  {currentPath === "/" && item.path !== "/" + item.name && (
                    <span className="truncate text-xs font-normal text-muted-foreground">
                      {item.path.slice(0, item.path.lastIndexOf("/"))}
                    </span>
                  )}
                </Button>
                {isFile && onPreview && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-label="Open file"
                    title="Open file"
                    className="mr-2 text-muted-foreground"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onPreview(item);
                    }}
                  >
                    <ExternalLink />
                    <span>Open</span>
                  </Button>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
