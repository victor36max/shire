import { useCallback, useEffect, useRef, useState } from "react";
import { X, Maximize2, File } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { SharedDriveEditor } from "./editor";
import CodeEditor from "./editor/CodeEditor";
import CsvEditor from "./editor/CsvEditor";
import { useFileContent } from "../hooks/shared-drive";
import { getPreviewType } from "../lib/file-utils";
import { useSubscription, type SharedDriveWsEvent } from "../lib/ws";

interface FilePreviewPanelProps {
  projectId: string;
  projectName: string;
  filePath: string;
  onClose: () => void;
  onExpand: () => void;
}

export default function FilePreviewPanel({
  projectId,
  projectName,
  filePath,
  onClose,
  onExpand,
}: FilePreviewPanelProps) {
  const fileName = filePath.split("/").pop() ?? "";
  const type = getPreviewType(fileName);
  const needsContent = type === "markdown" || type === "text" || type === "csv";

  const [refreshVersion, setRefreshVersion] = useState(0);
  const hasUnsavedChanges = useRef(false);
  const [externalChangeDetected, setExternalChangeDetected] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const {
    data: fileData,
    isLoading: loading,
    error: queryError,
  } = useFileContent(projectId, needsContent ? filePath : null);
  const content = fileData?.content ?? null;
  const error = queryError ? queryError.message || "Failed to load file" : null;

  const downloadUrl = `/api/projects/${projectName}/shared-drive/download?path=${encodeURIComponent(filePath)}`;

  const handleDirtyChange = useCallback((dirty: boolean) => {
    hasUnsavedChanges.current = dirty;
    if (!dirty) {
      setExternalChangeDetected(false);
    }
  }, []);

  const handleReload = useCallback(() => {
    setExternalChangeDetected(false);
    hasUnsavedChanges.current = false;
    setRefreshVersion((v) => v + 1);
  }, []);

  // Subscribe to file changes — debounce to wait for streaming edits to settle
  useSubscription<SharedDriveWsEvent>(
    `project:${projectId}:shared-drive`,
    useCallback(
      (event) => {
        if (event.type === "file_changed" && event.payload.path === filePath) {
          if (hasUnsavedChanges.current) {
            setExternalChangeDetected(true);
            return;
          }
          // Debounce: reset timer on each event, refresh only after writes settle
          if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = setTimeout(() => {
            refreshTimerRef.current = null;
            setRefreshVersion((v) => v + 1);
            toast("File updated", { duration: 2000 });
          }, 500);
        }
      },
      [filePath],
    ),
  );

  return (
    <div className="flex flex-col h-full border-l border-border">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-medium truncate flex-1">{fileName}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label="Expand to full view"
          onClick={onExpand}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label="Close panel"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* External change banner */}
      {externalChangeDetected && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
          <span className="text-xs flex-1">File changed externally.</span>
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={handleReload}>
            Reload
          </Button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Spinner size="sm" className="text-muted-foreground" />
          </div>
        )}
        {error && <p className="text-sm text-destructive p-4">{error}</p>}

        {!loading && !error && type === "markdown" && content !== null && (
          <SharedDriveEditor
            key={`${filePath}-${refreshVersion}`}
            initialMarkdown={content}
            projectId={projectId}
            filePath={filePath}
            onDirtyChange={handleDirtyChange}
          />
        )}

        {!loading && !error && type === "csv" && content !== null && (
          <CsvEditor
            key={`${filePath}-${refreshVersion}`}
            initialContent={content}
            projectId={projectId}
            filePath={filePath}
          />
        )}

        {!loading && !error && type === "text" && content !== null && (
          <CodeEditor
            key={`${filePath}-${refreshVersion}`}
            initialContent={content}
            projectId={projectId}
            filePath={filePath}
            onDirtyChange={handleDirtyChange}
          />
        )}

        {!loading && !error && type === "image" && (
          <div className="flex items-center justify-center p-4">
            <img
              src={downloadUrl}
              alt={fileName}
              loading="lazy"
              className="max-w-full max-h-[70vh] object-contain"
            />
          </div>
        )}

        {!loading && !error && type === "pdf" && (
          <iframe
            src={`/api/projects/${projectName}/shared-drive/preview?path=${encodeURIComponent(filePath)}`}
            className="w-full h-full border-0"
            title={fileName}
          />
        )}

        {!loading && !error && type === "unsupported" && (
          <div className="flex flex-col items-center justify-center py-12 gap-4 text-muted-foreground">
            <File className="h-12 w-12" />
            <p className="text-sm">Preview is not available for this file type.</p>
          </div>
        )}
      </div>
    </div>
  );
}
