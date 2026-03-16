import * as React from "react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "./components/ui/dialog";
import AppLayout from "./components/AppLayout";
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

interface Secret {
  id: number;
  key: string;
}

interface SecretListProps {
  secrets: Secret[];
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}

export default function SecretList({ secrets, pushEvent }: SecretListProps) {
  const [formOpen, setFormOpen] = React.useState(false);
  const [formTitle, setFormTitle] = React.useState("New Secret");
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [key, setKey] = React.useState("");
  const [value, setValue] = React.useState("");
  const [deleteSecret, setDeleteSecret] = React.useState<Secret | null>(null);

  const handleNew = () => {
    setKey("");
    setValue("");
    setEditingId(null);
    setFormTitle("New Secret");
    setFormOpen(true);
  };

  const handleEdit = (secret: Secret) => {
    setKey(secret.key);
    setValue("");
    setEditingId(secret.id);
    setFormTitle("Edit Secret");
    setFormOpen(true);
  };

  const handleClose = () => {
    setFormOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormOpen(false);
    if (editingId) {
      pushEvent("update-secret", { id: editingId, secret: { key, value } });
    } else {
      pushEvent("create-secret", { secret: { key, value } });
    }
  };

  const handleDeleteConfirm = () => {
    if (deleteSecret) {
      pushEvent("delete", { id: deleteSecret.id });
      setDeleteSecret(null);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Global Secrets</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => window.location.assign("/")}>
              Back to Agents
            </Button>
            <Button onClick={handleNew}>New Secret</Button>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Value</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {secrets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                  No secrets yet. Add your first secret to get started.
                </TableCell>
              </TableRow>
            ) : (
              secrets.map((secret) => (
                <TableRow key={secret.id}>
                  <TableCell className="font-medium">{secret.key}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">********</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(secret)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteSecret(secret)}
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

        <Dialog
          open={formOpen}
          onOpenChange={(isOpen) => {
            if (!isOpen) handleClose();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{formTitle}</DialogTitle>
              <DialogDescription>Secrets are encrypted at rest and available to all agents.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="key">Key</Label>
                <Input
                  id="key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="e.g. ANTHROPIC_API_KEY"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="value">Value</Label>
                <Input
                  id="value"
                  type="password"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Secret value"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button type="submit">Save Secret</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={!!deleteSecret}
          onOpenChange={(open) => {
            if (!open) setDeleteSecret(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Secret</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &ldquo;{deleteSecret?.key}&rdquo;? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleDeleteConfirm}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
}
