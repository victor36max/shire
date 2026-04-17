import * as React from "react";
import { useDropzone } from "react-dropzone";
import { Menu, Upload, Download, Trash2, Pencil, FolderOpen, AlertCircle } from "lucide-react";
import { Button } from "./ui/button";
import { SharedDriveEditor } from "./editor";
import CodeEditor from "./editor/CodeEditor";
import CsvEditor from "./editor/CsvEditor";
import { Spinner } from "./ui/spinner";
import { RenameDialog } from "./shared-drive/RenameDialog";
import { DeleteDialog } from "./shared-drive/DeleteDialog";
import {
  useProjectId,
  useFileContent,
  useDeleteSharedFile,
  useRenameSharedFile,
  useUploadSharedDriveFile,
  useSyncedParam,
} from "../hooks";
import { getFileIcon, getPreviewType, formatSize, MAX_UPLOAD_SIZE } from "../lib/file-utils";
import { useProjectLayout } from "../providers/ProjectLayoutProvider";
import { useAuthenticatedUrl } from "../hooks/use-authenticated-url";
import { authenticatedDownload } from "../lib/authenticated-download";

export default function SharedDriveContentArea() {
  const { projectId, projectName } = useProjectId();
  const { sidebarOpen, setSidebarOpen } = useProjectLayout();
  const [filePath, setFilePath] = useSyncedParam("file", `shire:file:${projectName}`);
  const fileName = filePath ? (filePath.split("/").pop() ?? "") : "";
  const type = filePath ? getPreviewType(fileName) : null;
  const needsContent = type === "markdown" || type === "text" || type === "csv";

  const {
    data: fileData,
    isLoading: loading,
    error: queryError,
  } = useFileContent(projectId, needsContent ? filePath : null);
  const content = fileData?.content ?? null;
  const error = queryError ? queryError.message || "Failed to load file" : null;

  const deleteSharedFile = useDeleteSharedFile(projectId ?? "");
  const renameSharedFile = useRenameSharedFile(projectId ?? "");
  const uploadFile = useUploadSharedDriveFile(projectId ?? "");

  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState<number | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const fileProgressRef = React.useRef<Map<string, number>>(new Map());

  const downloadUrl = filePath
    ? `/api/projects/${projectName}/shared-drive/download?path=${encodeURIComponent(filePath)}`
    : null;
  const previewUrl = filePath
    ? `/api/projects/${projectName}/shared-drive/preview?path=${encodeURIComponent(filePath)}`
    : null;

  const imageAuth = useAuthenticatedUrl(type === "image" ? downloadUrl : null);
  const pdfAuth = useAuthenticatedUrl(type === "pdf" ? previewUrl : null);

  const handleDelete = () => {
    if (!filePath) return;
    deleteSharedFile.mutate(filePath);
    setDeleteOpen(false);
    setFilePath(null);
  };

  const handleRename = (newName: string) => {
    if (!filePath) return;
    renameSharedFile.mutate(
      { path: filePath, newName },
      {
        onSuccess: (data: { ok: boolean; newPath: string }) => {
          setFilePath(data.newPath);
        },
      },
    );
    setRenameOpen(false);
  };

  const uploadFiles = React.useCallback(
    (accepted: File[]) => {
      const errors: string[] = [];
      const valid: File[] = [];
      for (const f of accepted) {
        if (f.size > MAX_UPLOAD_SIZE) {
          errors.push(`"${f.name}" is too large (${formatSize(f.size)}).`);
        } else {
          valid.push(f);
        }
      }
      if (errors.length > 0) setUploadError(errors.join(" "));
      else setUploadError(null);
      if (valid.length === 0) return;

      setUploadProgress(0);
      const updateAggregateProgress = () => {
        const values = [...fileProgressRef.current.values()];
        if (values.length === 0) {
          setUploadProgress(null);
          return;
        }
        setUploadProgress(Math.round(values.reduce((a, b) => a + b, 0) / values.length));
      };

      const uploadDir = filePath ? filePath.substring(0, filePath.lastIndexOf("/")) || "/" : "/";

      for (const f of valid) {
        const key = `${f.name}-${crypto.randomUUID()}`;
        fileProgressRef.current.set(key, 0);
        uploadFile
          .mutateAsync({
            file: f,
            path: uploadDir,
            onProgress: (percent) => {
              fileProgressRef.current.set(key, percent);
              updateAggregateProgress();
            },
          })
          .then(() => {
            fileProgressRef.current.delete(key);
            updateAggregateProgress();
          })
          .catch((err: unknown) => {
            fileProgressRef.current.delete(key);
            updateAggregateProgress();
            setUploadError(err instanceof Error ? err.message : "Upload failed");
          });
      }
    },
    [filePath, uploadFile],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted) => uploadFiles(accepted),
    multiple: true,
    noClick: true,
    noKeyboard: true,
    useFsAccessApi: false,
  });

  if (!projectId) return null;

  if (!filePath) {
    return (
      <div className="flex flex-col h-full" {...getRootProps()}>
        <input {...getInputProps()} />
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border md:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
        {isDragActive && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg">
            <div className="flex flex-col items-center gap-2 text-primary">
              <Upload className="h-8 w-8" />
              <span className="text-sm font-medium">Drop files here</span>
            </div>
          </div>
        )}
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
          <FolderOpen className="h-12 w-12" />
          <p className="text-sm">Select a file from the sidebar to preview or edit it.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative" {...getRootProps()}>
      <input {...getInputProps()} />

      {isDragActive && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Upload className="h-8 w-8" />
            <span className="text-sm font-medium">Drop files here</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Open menu"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <span className="text-sm font-medium truncate flex-1">{fileName}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Rename"
            onClick={() => setRenameOpen(true)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Download"
            onClick={() => {
              if (downloadUrl) authenticatedDownload(downloadUrl, fileName);
            }}
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            aria-label="Delete"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {uploadProgress !== null && (
        <div className="px-4 pt-1">
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-200"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}
      {uploadError && <p className="px-4 pt-1 text-xs text-destructive">{uploadError}</p>}

      <div className="flex-1 min-h-0 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Spinner size="sm" className="text-muted-foreground" />
          </div>
        )}
        {error && <p className="text-sm text-destructive p-4">{error}</p>}

        {!loading && !error && type === "markdown" && content !== null && (
          <SharedDriveEditor
            key={filePath}
            initialMarkdown={content}
            projectId={projectId}
            filePath={filePath}
          />
        )}

        {!loading && !error && type === "csv" && content !== null && (
          <CsvEditor
            key={filePath}
            initialContent={content}
            projectId={projectId}
            filePath={filePath}
          />
        )}

        {!loading && !error && type === "text" && content !== null && (
          <CodeEditor
            key={filePath}
            initialContent={content}
            projectId={projectId}
            filePath={filePath}
          />
        )}

        {!loading && !error && type === "image" && (
          <div className="flex items-center justify-center p-4">
            {imageAuth.isLoading && <Spinner size="sm" className="text-muted-foreground" />}
            {imageAuth.error && (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <AlertCircle className="h-8 w-8" />
                <p className="text-sm">{imageAuth.error}</p>
              </div>
            )}
            {imageAuth.blobUrl && (
              <img
                src={imageAuth.blobUrl}
                alt={fileName}
                className="max-w-full max-h-[70vh] object-contain"
              />
            )}
          </div>
        )}

        {!loading && !error && type === "pdf" && (
          <>
            {pdfAuth.isLoading && (
              <div className="flex items-center justify-center py-12">
                <Spinner size="sm" className="text-muted-foreground" />
              </div>
            )}
            {pdfAuth.blobUrl && (
              <iframe src={pdfAuth.blobUrl} className="w-full h-full border-0" title={fileName} />
            )}
          </>
        )}

        {!loading &&
          !error &&
          type === "unsupported" &&
          (() => {
            const UnsupportedIcon = getFileIcon(fileName);
            return (
              <div className="flex flex-col items-center justify-center py-12 gap-4 text-muted-foreground">
                <UnsupportedIcon className="h-12 w-12" />
                <p className="text-sm">Preview is not available for this file type.</p>
              </div>
            );
          })()}
      </div>

      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        currentName={fileName}
        onRename={handleRename}
      />

      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        name={fileName}
        type="file"
        onConfirm={handleDelete}
      />
    </div>
  );
}
