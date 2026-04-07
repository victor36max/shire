import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import { useCallback, useEffect, useState } from "react";
import { OPEN_INSERT_IMAGE_DIALOG_COMMAND } from "./image-commands";
import { $getSelection, $isRangeSelection, COMMAND_PRIORITY_HIGH } from "lexical";
import { $createImageNode } from "../nodes/ImageNode";
import { isValidUrl } from "../../lib/utils";
import { Image } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";

export const InsertImagePlugin = (): React.JSX.Element | null => {
  const [editor] = useLexicalComposerContext();
  const [isOpen, setIsOpen] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const insertImage = useCallback(
    (url: string, altText: string | null) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!selection || !$isRangeSelection(selection)) {
          return;
        }
        const imageNode = $createImageNode(url, altText);
        selection.insertNodes([imageNode]);
        imageNode.selectNext();
      });
    },
    [editor],
  );

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        OPEN_INSERT_IMAGE_DIALOG_COMMAND,
        () => {
          setIsOpen(true);
          setUrlError(null);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [editor]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) {
          setUrlError(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <div className="flex flex-row items-center gap-2">
            <Image className="w-4 h-4 text-muted-foreground" />
            <DialogTitle>Insert image</DialogTitle>
          </div>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setUrlError(null);
            const formData = new FormData(e.currentTarget);
            const url = formData.get("imageUrl");
            const alt = formData.get("altText");
            if (typeof url !== "string" || url.trim().length === 0) {
              setUrlError("Image URL is required");
              return;
            }
            const trimmedUrl = url.trim();
            if (!isValidUrl(trimmedUrl)) {
              setUrlError("Please enter a valid URL");
              return;
            }
            insertImage(trimmedUrl, typeof alt === "string" ? alt : null);
            setIsOpen(false);
          }}
          className="space-y-3"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="imageUrl">Image URL</Label>
            <Input
              id="imageUrl"
              name="imageUrl"
              required
              placeholder="https://example.com/image.png"
              onChange={() => setUrlError(null)}
            />
            {urlError && <p className="text-xs text-destructive">{urlError}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="altText">Alt text (optional)</Label>
            <Input id="altText" name="altText" placeholder="Describe the image" />
          </div>
          <div className="flex flex-row justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Insert</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
