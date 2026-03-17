import * as React from "react";
import { Button } from "./components/ui/button";
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
import AppLayout from "./components/AppLayout";

export interface SharedDriveFile {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
}

interface SharedDriveProps {
  files: SharedDriveFile[];
  current_path: string;
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
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

export default function SharedDrive({ files, current_path, pushEvent }: SharedDriveProps) {
  const [newFolderOpen, setNewFolderOpen] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<SharedDriveFile | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const navigate = (path: string) => {
    pushEvent("navigate", { path });
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
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      pushEvent("upload-file", { name: file.name, content: base64 });
    };
    reader.readAsDataURL(file);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const sortedFiles = [...files].sort((a, b) => {
    // Directories first, then alphabetical
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <AppLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Shared Drive</h1>
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

        {/* File Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-[100px]">Size</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedFiles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    This directory is empty
                  </TableCell>
                </TableRow>
              ) : (
                sortedFiles.map((file) => (
                  <TableRow key={file.path}>
                    <TableCell>
                      {file.type === "directory" ? (
                        <button
                          className="flex items-center gap-2 hover:underline text-left"
                          onClick={() => navigate("/" + file.path)}
                        >
                          <span className="text-muted-foreground">📁</span>
                          {file.name}
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">📄</span>
                          {file.name}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {file.type === "file" ? formatSize(file.size) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {file.type === "file" && (
                          <Button variant="ghost" size="sm" asChild>
                            <a href={`/shared/download?path=${encodeURIComponent(file.path)}`} download>
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
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
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
            <AlertDialogAction onClick={() => deleteTarget && handleDelete(deleteTarget)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
