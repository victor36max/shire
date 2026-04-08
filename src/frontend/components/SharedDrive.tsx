import * as React from "react";
import { useDropzone } from "react-dropzone";
import { Button, buttonVariants } from "./ui/button";
import { Input } from "./ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import AppLayout from "./AppLayout";
import {
  ChevronLeft,
  Folder,
  File,
  X,
  Download,
  Upload,
  FolderPlus,
  FileText,
  Trash2,
} from "lucide-react";
import { Spinner, PageLoader } from "./ui/spinner";
import { ErrorState } from "./ui/error-state";
import { useNavigate } from "react-router-dom";
import {
  useProjectId,
  useSharedDrive,
  useCreateDirectory,
  useCreateFile,
  useDeleteSharedFile,
  useUploadSharedDriveFile,
  usePreviewFile,
} from "../hooks";

import { SharedDriveEditor } from "./editor";
import type { SharedDriveFile } from "../hooks/shared-drive";
export type { SharedDriveFile };

type PreviewType = "markdown" | "text" | "image" | "pdf" | "unsupported";

const TEXT_EXTENSIONS = new Set([
  "txt",
  "json",
  "yaml",
  "yml",
  "toml",
  "csv",
  "log",
  "sh",
  "bash",
  "zsh",
  "js",
  "ts",
  "jsx",
  "tsx",
  "py",
  "rb",
  "ex",
  "exs",
  "erl",
  "rs",
  "go",
  "java",
  "c",
  "cpp",
  "h",
  "html",
  "css",
  "scss",
  "xml",
  "sql",
  "env",
  "gitignore",
  "dockerfile",
  "makefile",
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"]);

function getFileExtension(name: string): string {
  const lower = name.toLowerCase();
  const dotIndex = lower.lastIndexOf(".");
  return dotIndex > 0 ? lower.slice(dotIndex + 1) : lower;
}

function getPreviewType(name: string): PreviewType {
  const ext = getFileExtension(name);
  if (ext === "md" || ext === "mdx") return "markdown";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return "unsupported";
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_UPLOAD_SIZE = 128 * 1024 * 1024; // 128 MB

function Breadcrumbs({ path, onNavigate }: { path: string; onNavigate: (path: string) => void }) {
  const segments = path.split("/").filter(Boolean);

  return (
    <div className="flex items-center gap-1 text-sm">
      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onNavigate("/")}>
        shared
      </Button>
      {segments.map((segment, i) => {
        const segmentPath = "/" + segments.slice(0, i + 1).join("/");
        return (
          <React.Fragment key={segmentPath}>
            <span className="text-muted-foreground">/</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => onNavigate(segmentPath)}
            >
              {segment}
            </Button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function PreviewContent({
  file,
  projectId,
  projectName,
  content,
  loading,
  error,
}: {
  file: SharedDriveFile;
  projectId: string;
  projectName: string;
  content: string | null;
  loading: boolean;
  error: string | null;
}) {
  const type = getPreviewType(file.name);
  const previewUrl = `/api/projects/${projectName}/shared-drive/preview?path=${encodeURIComponent(file.path)}`;

  if (error) {
    return <p className="text-sm text-destructive p-4">{error}</p>;
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground p-4">Loading preview...</p>;
  }

  switch (type) {
    case "markdown":
      return content !== null ? (
        <SharedDriveEditor
          key={file.path}
          initialMarkdown={content}
          projectId={projectId}
          filePath={file.path}
        />
      ) : null;

    case "text":
      return content !== null ? (
        <pre className="text-sm font-mono whitespace-pre-wrap bg-muted rounded p-4 overflow-auto">
          {content}
        </pre>
      ) : null;

    case "image":
      return (
        <img
          src={previewUrl}
          alt={file.name}
          loading="lazy"
          className="max-w-full max-h-[70vh] object-contain"
        />
      );

    case "pdf":
      return (
        <iframe src={previewUrl} className="w-full h-[70vh] rounded border" title={file.name} />
      );

    case "unsupported":
      return (
        <div className="flex flex-col items-center justify-center py-12 gap-4 text-muted-foreground">
          <File className="h-12 w-12" />
          <p className="text-sm">Preview is not available for this file type.</p>
        </div>
      );
  }
}

export default function SharedDrive() {
  const navigateTo = useNavigate();
  const { projectId, projectName } = useProjectId();
  const [currentPath, setCurrentPath] = React.useState("/");

  const {
    data,
    isLoading: filesLoading,
    isError: filesError,
    error: filesErrorObj,
    refetch: refetchFiles,
  } = useSharedDrive(projectId, currentPath);
  const files = data?.files ?? [];

  const createDirectory = useCreateDirectory(projectId ?? "");
  const createFile = useCreateFile(projectId ?? "");
  const deleteSharedFile = useDeleteSharedFile(projectId ?? "");
  const uploadFile = useUploadSharedDriveFile(projectId ?? "");
  const [uploadProgress, setUploadProgress] = React.useState<number | null>(null);
  const fileProgressRef = React.useRef<Map<string, number>>(new Map());
  const previewFileMutation = usePreviewFile(projectId ?? "");

  const [newFolderOpen, setNewFolderOpen] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState("");
  const [newMarkdownOpen, setNewMarkdownOpen] = React.useState(false);
  const [newMarkdownName, setNewMarkdownName] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<SharedDriveFile | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  const [previewFile, setPreviewFile] = React.useState<SharedDriveFile | null>(null);
  const [previewContent, setPreviewContent] = React.useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const currentPreviewPath = React.useRef<string | null>(null);

  // Lock body scroll on mobile when lightbox is open
  React.useEffect(() => {
    if (!previewFile) return;
    const mq = window.matchMedia("(max-width: 767px)");
    if (!mq.matches) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [previewFile]);

  const navigate = (path: string) => {
    setUploadError(null);
    setPreviewFile(null);
    currentPreviewPath.current = null;
    setCurrentPath(path);
  };

  const handlePreview = (file: SharedDriveFile) => {
    if (previewFile?.path === file.path) {
      setPreviewFile(null);
      currentPreviewPath.current = null;
      return;
    }

    const type = getPreviewType(file.name);
    setPreviewFile(file);
    setPreviewContent(null);
    setPreviewError(null);
    currentPreviewPath.current = file.path;

    if (type === "markdown" || type === "text") {
      setPreviewLoading(true);
      const expectedPath = file.path;
      previewFileMutation.mutate(file.path, {
        onSuccess: (reply) => {
          if (currentPreviewPath.current !== expectedPath) return;
          setPreviewLoading(false);
          setPreviewContent(reply.content);
        },
        onError: (err) => {
          if (currentPreviewPath.current !== expectedPath) return;
          setPreviewLoading(false);
          setPreviewError(err.message || "Failed to load preview");
        },
      });
    } else {
      setPreviewLoading(false);
    }
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    createDirectory.mutate({ name: newFolderName.trim(), path: currentPath });
    setNewFolderName("");
    setNewFolderOpen(false);
  };

  const handleCreateMarkdown = () => {
    const trimmedName = newMarkdownName.trim();
    if (!trimmedName) return;
    setNewMarkdownName("");
    setNewMarkdownOpen(false);
    createFile.mutate(
      { name: trimmedName, path: currentPath },
      {
        onSuccess: (data) => {
          const filename = trimmedName.endsWith(".md") ? trimmedName : `${trimmedName}.md`;
          const newFile: SharedDriveFile = {
            name: filename,
            path: data.path,
            type: "file",
            size: 0,
          };
          setPreviewFile(newFile);
          setPreviewContent("");
          setPreviewLoading(false);
          setPreviewError(null);
          currentPreviewPath.current = newFile.path;
        },
      },
    );
  };

  const handleDelete = (file: SharedDriveFile) => {
    deleteSharedFile.mutate(file.path);
    setDeleteTarget(null);
    if (previewFile?.path === file.path) {
      setPreviewFile(null);
    }
  };

  const uploadFiles = React.useCallback(
    (files: File[]) => {
      const errors: string[] = [];
      const valid: File[] = [];
      for (const file of files) {
        if (file.size > MAX_UPLOAD_SIZE) {
          errors.push(
            `"${file.name}" is too large (${formatSize(file.size)}). Max ${formatSize(MAX_UPLOAD_SIZE)}.`,
          );
        } else {
          valid.push(file);
        }
      }
      if (errors.length > 0) {
        setUploadError(errors.join(" "));
      } else {
        setUploadError(null);
      }
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

      for (const file of valid) {
        const key = `${file.name}-${crypto.randomUUID()}`;
        fileProgressRef.current.set(key, 0);

        uploadFile
          .mutateAsync({
            file,
            path: currentPath,
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
    [currentPath, uploadFile],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: (accepted) => uploadFiles(accepted),
    multiple: true,
    noClick: true,
    noKeyboard: true,
    useFsAccessApi: false,
  });

  const sortedFiles = [...files].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  if (!projectId) {
    return <PageLoader />;
  }

  return (
    <AppLayout maxWidth={previewFile ? "wide" : "default"}>
      <div {...getRootProps()} className="space-y-4 relative">
        <input {...getInputProps()} />
        {isDragActive && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg">
            <div className="flex flex-col items-center gap-2 text-primary">
              <Upload className="h-8 w-8" />
              <span className="text-sm font-medium">Drop files here</span>
            </div>
          </div>
        )}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back"
            onClick={() => navigateTo(`/projects/${projectName}`)}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Shared Drive</h1>
        </div>
        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <Breadcrumbs path={currentPath} onNavigate={navigate} />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Upload File" onClick={open}>
              <Upload className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="New Markdown"
              onClick={() => setNewMarkdownOpen(true)}
            >
              <FileText className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="New Folder"
              onClick={() => setNewFolderOpen(true)}
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
        {uploadProgress !== null && (
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-200"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        )}

        {/* File Table + Preview Panel */}
        <div className="flex gap-4">
          {/* File Table — hidden on mobile when preview is open */}
          <div
            className={`rounded-md border ${previewFile ? "hidden md:block md:w-1/3" : "w-full"} min-w-0`}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[100px]">Size</TableHead>
                  {!previewFile && <TableHead className="w-[100px] text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filesLoading ? (
                  <TableRow>
                    <TableCell colSpan={previewFile ? 2 : 3} className="text-center py-8">
                      <Spinner size="sm" className="text-muted-foreground mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : filesError ? (
                  <TableRow>
                    <TableCell colSpan={previewFile ? 2 : 3}>
                      <ErrorState
                        message={filesErrorObj?.message || "Failed to load files"}
                        onRetry={() => refetchFiles()}
                      />
                    </TableCell>
                  </TableRow>
                ) : sortedFiles.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={previewFile ? 2 : 3}
                      className="text-center text-muted-foreground py-8"
                    >
                      This directory is empty
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedFiles.map((file) => (
                    <TableRow
                      key={file.path}
                      className={previewFile?.path === file.path ? "bg-muted/50" : undefined}
                    >
                      <TableCell>
                        {file.type === "directory" ? (
                          <Button
                            variant="link"
                            className="flex items-center gap-2 text-foreground h-auto p-0"
                            onClick={() => navigate(file.path)}
                          >
                            <Folder className="h-4 w-4 text-muted-foreground" />
                            {file.name}
                          </Button>
                        ) : (
                          <Button
                            variant="link"
                            className="flex items-center gap-2 text-foreground h-auto p-0"
                            onClick={() => handlePreview(file)}
                          >
                            <File className="h-4 w-4 text-muted-foreground" />
                            {file.name}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {file.type === "file" ? formatSize(file.size) : "—"}
                      </TableCell>
                      {!previewFile && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {file.type === "file" && (
                              <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                                <a
                                  href={`/api/projects/${projectName}/shared-drive/download?path=${encodeURIComponent(file.path)}`}
                                  download
                                  aria-label="Download"
                                >
                                  <Download className="h-4 w-4" />
                                </a>
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              aria-label="Delete"
                              onClick={() => setDeleteTarget(file)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Preview Panel: fullscreen lightbox on mobile, inline side-by-side on desktop */}
          {previewFile && (
            <div className="fixed inset-0 z-50 bg-background flex flex-col md:static md:inset-auto md:z-auto md:bg-transparent md:w-2/3 md:min-w-0 md:rounded-md md:border md:max-h-[calc(100vh-12rem)]">
              <div className="flex items-center justify-between border-b px-4 py-2">
                <span className="text-sm font-medium truncate">{previewFile.name}</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                    <a
                      href={`/api/projects/${projectName}/shared-drive/download?path=${encodeURIComponent(previewFile.path)}`}
                      download
                      aria-label="Download"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    aria-label="Delete"
                    onClick={() => setDeleteTarget(previewFile)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Close preview"
                    onClick={() => {
                      setPreviewFile(null);
                      currentPreviewPath.current = null;
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <PreviewContent
                  file={previewFile}
                  projectId={projectId}
                  projectName={projectName}
                  content={previewContent}
                  loading={previewLoading}
                  error={previewError}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Folder Dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
            <DialogDescription>Create a new folder in the shared drive.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Markdown Dialog */}
      <Dialog open={newMarkdownOpen} onOpenChange={setNewMarkdownOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Markdown</DialogTitle>
            <DialogDescription>Create a new markdown file in the shared drive.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="File name"
              value={newMarkdownName}
              onChange={(e) => setNewMarkdownName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateMarkdown();
              }}
              autoFocus
            />
            <p className="text-xs text-muted-foreground mt-2">
              .md extension will be added automatically
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewMarkdownOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateMarkdown} disabled={!newMarkdownName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteTarget?.type === "directory" ? "folder" : "file"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{deleteTarget?.name}&rdquo;
              {deleteTarget?.type === "directory" && " and all its contents"}. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
