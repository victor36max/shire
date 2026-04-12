import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "../ui/dialog";
import { RenameDialog } from "../shared-drive/RenameDialog";
import { DeleteDialog } from "../shared-drive/DeleteDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Folder, Upload, FolderPlus, FileText, Trash2, Download, Pencil } from "lucide-react";
import { Spinner } from "../ui/spinner";
import {
  useProjectId,
  useSharedDrive,
  useCreateDirectory,
  useCreateFile,
  useDeleteSharedFile,
  useRenameSharedFile,
  useUploadSharedDriveFile,
} from "../../hooks";
import { formatSize, getFileIcon, MAX_UPLOAD_SIZE } from "../../lib/file-utils";
import type { SharedDriveFile } from "../../hooks/shared-drive";

function Breadcrumbs({ path, onNavigate }: { path: string; onNavigate: (path: string) => void }) {
  const segments = path.split("/").filter(Boolean);

  return (
    <div className="flex items-center gap-0.5 text-xs min-w-0 overflow-hidden">
      <button
        type="button"
        className="shrink-0 px-1 py-0.5 rounded hover:bg-muted text-muted-foreground"
        onClick={() => onNavigate("/")}
      >
        shared
      </button>
      {segments.map((segment, i) => {
        const segmentPath = "/" + segments.slice(0, i + 1).join("/");
        return (
          <React.Fragment key={segmentPath}>
            <span className="text-muted-foreground shrink-0">/</span>
            <button
              type="button"
              className="truncate px-1 py-0.5 rounded hover:bg-muted text-muted-foreground"
              onClick={() => onNavigate(segmentPath)}
            >
              {segment}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function SharedDrivePanel() {
  const { projectId, projectName } = useProjectId();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedFile = searchParams.get("file");
  const parentDir = selectedFile
    ? selectedFile.substring(0, selectedFile.lastIndexOf("/")) || "/"
    : null;
  const [currentPath, setCurrentPath] = React.useState(parentDir ?? "/");
  const prevParentDir = React.useRef(parentDir);

  // Sync currentPath when selectedFile changes externally (e.g. direct URL navigation)
  if (parentDir !== prevParentDir.current) {
    prevParentDir.current = parentDir;
    if (parentDir !== null && parentDir !== currentPath) {
      setCurrentPath(parentDir);
    }
  }

  const {
    data,
    isLoading: filesLoading,
    isError: filesError,
  } = useSharedDrive(projectId, currentPath);
  const files = data?.files ?? [];

  const createDirectory = useCreateDirectory(projectId ?? "");
  const createFile = useCreateFile(projectId ?? "");
  const deleteSharedFile = useDeleteSharedFile(projectId ?? "");
  const renameSharedFile = useRenameSharedFile(projectId ?? "");
  const uploadFile = useUploadSharedDriveFile(projectId ?? "");

  const [uploadProgress, setUploadProgress] = React.useState<number | null>(null);
  const fileProgressRef = React.useRef<Map<string, number>>(new Map());
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  const [newFolderOpen, setNewFolderOpen] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState("");
  const [newMarkdownOpen, setNewMarkdownOpen] = React.useState(false);
  const [newMarkdownName, setNewMarkdownName] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<SharedDriveFile | null>(null);
  const [renameTarget, setRenameTarget] = React.useState<SharedDriveFile | null>(null);

  const navigate = (path: string) => {
    setUploadError(null);
    setCurrentPath(path);
  };

  const selectFile = (file: SharedDriveFile) => {
    setSearchParams({ file: file.path });
  };

  const handleRename = (newName: string) => {
    if (!renameTarget) return;
    renameSharedFile.mutate(
      { path: renameTarget.path, newName },
      {
        onSuccess: (data: { ok: boolean; newPath: string }) => {
          if (selectedFile === renameTarget.path) {
            setSearchParams({ file: data.newPath });
          }
        },
      },
    );
    setRenameTarget(null);
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
          setSearchParams({ file: data.path });
        },
      },
    );
  };

  const handleDelete = (file: SharedDriveFile) => {
    deleteSharedFile.mutate(file.path);
    setDeleteTarget(null);
    if (selectedFile === file.path) {
      setSearchParams({});
    }
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

      for (const f of valid) {
        const key = `${f.name}-${crypto.randomUUID()}`;
        fileProgressRef.current.set(key, 0);
        uploadFile
          .mutateAsync({
            file: f,
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

  const { getInputProps, open: openFilePicker } = useDropzone({
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

  return (
    <>
      <input {...getInputProps()} />
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <Breadcrumbs path={currentPath} onNavigate={navigate} />
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Upload File"
            onClick={openFilePicker}
          >
            <Upload className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="New Markdown"
            onClick={() => setNewMarkdownOpen(true)}
          >
            <FileText className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="New Folder"
            onClick={() => setNewFolderOpen(true)}
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {uploadProgress !== null && (
        <div className="px-3 pt-1">
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-200"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}
      {uploadError && <p className="px-3 pt-1 text-xs text-destructive">{uploadError}</p>}

      <div className="flex-1 overflow-y-auto py-1">
        {filesLoading && (
          <div className="flex items-center justify-center py-6">
            <Spinner size="sm" className="text-muted-foreground" />
          </div>
        )}
        {filesError && (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-destructive">Failed to load files</p>
          </div>
        )}
        {!filesLoading && !filesError && sortedFiles.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-muted-foreground">Empty directory</p>
          </div>
        )}
        {sortedFiles.map((file) => {
          const FileTypeIcon = file.type === "directory" ? Folder : getFileIcon(file.name);
          return (
            <div key={file.path} className="group flex items-center mx-1">
              <button
                type="button"
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm flex-1 min-w-0 text-left ${
                  selectedFile === file.path
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted text-foreground"
                }`}
                onClick={() => {
                  if (file.type === "directory") {
                    navigate(file.path);
                  } else {
                    selectFile(file);
                  }
                }}
              >
                <FileTypeIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="truncate">{file.name}</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 rounded hover:bg-background text-muted-foreground"
                    aria-label={`${file.name} actions`}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <circle cx="8" cy="3" r="1.5" />
                      <circle cx="8" cy="8" r="1.5" />
                      <circle cx="8" cy="13" r="1.5" />
                    </svg>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {file.type === "file" && (
                    <DropdownMenuItem asChild>
                      <a
                        href={`/api/projects/${projectName}/shared-drive/download?path=${encodeURIComponent(file.path)}`}
                        download
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </a>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setRenameTarget(file)}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteTarget(file)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
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

      {renameTarget && (
        <RenameDialog
          open={!!renameTarget}
          onOpenChange={(open) => !open && setRenameTarget(null)}
          currentName={renameTarget.name}
          onRename={handleRename}
        />
      )}

      {deleteTarget && (
        <DeleteDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          name={deleteTarget.name}
          type={deleteTarget.type}
          onConfirm={() => handleDelete(deleteTarget)}
        />
      )}
    </>
  );
}
