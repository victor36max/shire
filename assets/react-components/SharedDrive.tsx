import * as React from "react";
import { Button, buttonVariants } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "./components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import AppLayout from "./components/AppLayout";
import Markdown from "./components/Markdown";
import { ChevronLeft, Folder, File, X, Download } from "lucide-react";
import { navigate as navigateTo } from "./lib/navigate";

export interface SharedDriveFile {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
}

interface SharedDriveProps {
  project: { id: string; name: string };
  files: SharedDriveFile[];
  current_path: string;
  pushEvent: (
    event: string,
    payload: Record<string, unknown>,
    onReply?: (reply: Record<string, unknown>) => void,
  ) => void;
}

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
  if (ext === "md") return "markdown";
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
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onNavigate(segmentPath)}>
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
  projectName,
  content,
  loading,
  error,
}: {
  file: SharedDriveFile;
  projectName: string;
  content: string | null;
  loading: boolean;
  error: string | null;
}) {
  const type = getPreviewType(file.name);
  const previewUrl = `/projects/${projectName}/shared/preview?path=${encodeURIComponent(file.path)}`;

  if (error) {
    return <p className="text-sm text-destructive p-4">{error}</p>;
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground p-4">Loading preview...</p>;
  }

  switch (type) {
    case "markdown":
      return content !== null ? (
        <Tabs defaultValue="preview">
          <TabsList>
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="source">Source</TabsTrigger>
          </TabsList>
          <TabsContent value="preview" className="overflow-auto">
            <Markdown>{content}</Markdown>
          </TabsContent>
          <TabsContent value="source" className="overflow-auto">
            <pre className="text-sm font-mono whitespace-pre-wrap bg-muted rounded p-4">{content}</pre>
          </TabsContent>
        </Tabs>
      ) : null;

    case "text":
      return content !== null ? (
        <pre className="text-sm font-mono whitespace-pre-wrap bg-muted rounded p-4 overflow-auto">{content}</pre>
      ) : null;

    case "image":
      return <img src={previewUrl} alt={file.name} className="max-w-full max-h-[70vh] object-contain" />;

    case "pdf":
      return <iframe src={previewUrl} className="w-full h-[70vh] rounded border" title={file.name} />;

    case "unsupported":
      return (
        <div className="flex flex-col items-center justify-center py-12 gap-4 text-muted-foreground">
          <File className="h-12 w-12" />
          <p className="text-sm">Preview is not available for this file type.</p>
        </div>
      );
  }
}

export default function SharedDrive({ project, files, current_path, pushEvent }: SharedDriveProps) {
  const [newFolderOpen, setNewFolderOpen] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<SharedDriveFile | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [previewFile, setPreviewFile] = React.useState<SharedDriveFile | null>(null);
  const [previewContent, setPreviewContent] = React.useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const currentPreviewPath = React.useRef<string | null>(null);

  const navigate = (path: string) => {
    setUploadError(null);
    setPreviewFile(null);
    currentPreviewPath.current = null;
    pushEvent("navigate", { path });
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
      pushEvent("preview-file", { path: file.path }, (reply) => {
        if (currentPreviewPath.current !== expectedPath) return;
        setPreviewLoading(false);
        if (reply.error) {
          setPreviewError(reply.error as string);
        } else {
          setPreviewContent(reply.content as string);
        }
      });
    } else {
      setPreviewLoading(false);
    }
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    pushEvent("create-directory", { name: newFolderName.trim() });
    setNewFolderName("");
    setNewFolderOpen(false);
  };

  const handleDelete = (file: SharedDriveFile) => {
    if (file.type === "directory") {
      pushEvent("delete-directory", { path: file.path });
    } else {
      pushEvent("delete-file", { path: file.path });
    }
    setDeleteTarget(null);
    if (previewFile?.path === file.path) {
      setPreviewFile(null);
    }
  };

  const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50 MB

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_SIZE) {
      setUploadError(
        `File is too large (${formatSize(file.size)}). Maximum upload size is ${formatSize(MAX_UPLOAD_SIZE)}.`,
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploadError(null);

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      pushEvent("upload-file", { name: file.name, content: base64 });
    };
    reader.readAsDataURL(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const sortedFiles = [...files].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Back" onClick={() => navigateTo(`/projects/${project.name}`)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Shared Drive</h1>
        </div>
        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <Breadcrumbs path={current_path} onNavigate={navigate} />
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              Upload File
            </Button>
            <Button variant="outline" size="sm" onClick={() => setNewFolderOpen(true)}>
              New Folder
            </Button>
          </div>
        </div>

        {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}

        {/* File Table + Preview Panel */}
        <div className="flex gap-4">
          {/* File Table */}
          <div className={`rounded-md border ${previewFile ? "w-1/2" : "w-full"} min-w-0`}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[100px]">Size</TableHead>
                  {!previewFile && <TableHead className="w-[100px] text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedFiles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={previewFile ? 2 : 3} className="text-center text-muted-foreground py-8">
                      This directory is empty
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedFiles.map((file) => (
                    <TableRow key={file.path} className={previewFile?.path === file.path ? "bg-muted/50" : undefined}>
                      <TableCell>
                        {file.type === "directory" ? (
                          <Button
                            variant="link"
                            className="flex items-center gap-2 text-foreground h-auto p-0"
                            onClick={() => navigate("/" + file.path)}
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
                              <Button variant="ghost" size="sm" asChild>
                                <a
                                  href={`/projects/${project.name}/shared/download?path=${encodeURIComponent(file.path)}`}
                                  download
                                >
                                  Download
                                </a>
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setDeleteTarget(file)}
                            >
                              Delete
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

          {/* Preview Panel */}
          {previewFile && (
            <div className="w-1/2 min-w-0 rounded-md border flex flex-col">
              <div className="flex items-center justify-between border-b px-4 py-2">
                <span className="text-sm font-medium truncate">{previewFile.name}</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" asChild>
                    <a
                      href={`/projects/${project.name}/shared/download?path=${encodeURIComponent(previewFile.path)}`}
                      download
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(previewFile)}
                  >
                    Delete
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPreviewFile(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <PreviewContent
                  file={previewFile}
                  projectName={project.name}
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

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.type === "directory" ? "folder" : "file"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{deleteTarget?.name}&rdquo;
              {deleteTarget?.type === "directory" && " and all its contents"}. This action cannot be undone.
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
