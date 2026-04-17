import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey } from "lexical";
import { useState } from "react";
import { ChevronDown, ImageOff, Loader2, Trash, Type } from "lucide-react";
import { useAuthenticatedUrl } from "../../../hooks/use-authenticated-url";
import { $isImageNode } from "./ImageNode";
import { cn } from "../../../components/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";

type ImageComponentProps = {
  src: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  nodeKey: string;
};

export const ImageComponent = ({ src, altText, width, height, nodeKey }: ImageComponentProps) => {
  const [editor] = useLexicalComposerContext();
  const [isAltDialogOpen, setIsAltDialogOpen] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const needsAuth = src.startsWith("/api/");
  const authUrl = useAuthenticatedUrl(needsAuth ? src : null);
  const effectiveSrc = needsAuth ? authUrl.blobUrl : src;

  const updateAltText = (nextAltText: string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (!$isImageNode(node)) return;
      node.setAltText(nextAltText || null);
    });
  };

  const deleteImage = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      node?.remove();
    });
  };

  return (
    <div className="flex flex-col items-center group relative">
      <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Image actions"
              className={cn(
                "inline-flex items-center justify-center rounded-md h-7 w-7",
                "bg-background/90 border border-muted shadow-sm",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setIsAltDialogOpen(true)}>
              <Type className="w-4 h-4 mr-2 text-muted-foreground" />
              Update alt text
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onSelect={deleteImage}>
              <Trash className="w-4 h-4 mr-2" />
              Delete image
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {hasError ? (
        <div
          className="font-sans flex flex-col items-center justify-center gap-3 w-full border border-dashed border-muted rounded-lg bg-muted/30 text-muted-foreground"
          style={{
            height: height ? `${height}px` : "200px",
            maxWidth: width ? `${width}px` : "100%",
          }}
        >
          <ImageOff className="w-6 h-6" />
          <span className="text-sm">Failed to load image</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setHasError(false);
              setRetryKey((k) => k + 1);
            }}
          >
            Retry
          </Button>
        </div>
      ) : needsAuth && authUrl.isLoading ? (
        <div
          className="flex items-center justify-center"
          style={{
            height: height ? `${height}px` : "100px",
            width: width ? `${width}px` : "100%",
          }}
        >
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : effectiveSrc ? (
        <img
          key={retryKey}
          src={effectiveSrc}
          alt={altText || ""}
          width={width ?? undefined}
          height={height ?? undefined}
          className="max-w-full h-auto"
          onError={() => setHasError(true)}
        />
      ) : null}
      {altText && !hasError && <p className="text-sm text-muted-foreground italic">{altText}</p>}
      <Dialog open={isAltDialogOpen} onOpenChange={setIsAltDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update alt text</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const nextAltText = formData.get("altText");
              if (typeof nextAltText !== "string") return;
              updateAltText(nextAltText.trim());
              setIsAltDialogOpen(false);
            }}
            className="space-y-3"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="altText">Alt text</Label>
              <Input
                id="altText"
                name="altText"
                defaultValue={altText || ""}
                placeholder="Describe the image"
              />
            </div>
            <div className="flex flex-row justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setIsAltDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
