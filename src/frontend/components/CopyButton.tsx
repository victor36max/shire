import * as React from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "./ui/button";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access denied (non-HTTPS, unfocused document, etc.)
    }
  }, [text]);

  return (
    <Button
      type="button"
      variant="ghost"
      className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy message"}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}
