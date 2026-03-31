import * as React from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";

export function CopyButton({ text }: { text: string }) {
  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  }, [text]);

  return (
    <Button
      type="button"
      variant="ghost"
      className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
      onClick={handleCopy}
      aria-label="Copy message"
    >
      <Copy className="h-3 w-3" />
    </Button>
  );
}
