import { useState } from "react";
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

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  onRename: (newName: string) => void;
}

export function RenameDialog({ open, onOpenChange, currentName, onRename }: RenameDialogProps) {
  const [name, setName] = useState(currentName);

  // Reset name when dialog opens with a new file
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) setName(currentName);
    onOpenChange(isOpen);
  };

  const handleSubmit = () => {
    if (name.trim() && name.trim() !== currentName) {
      onRename(name.trim());
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
          <DialogDescription>Enter a new name for &ldquo;{currentName}&rdquo;.</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || name.trim() === currentName}>
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
