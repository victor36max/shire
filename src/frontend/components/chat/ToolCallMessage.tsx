import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { type Message } from "./types";

export const ToolCallMessage = React.memo(function ToolCallMessage({ msg }: { msg: Message }) {
  const [open, setOpen] = React.useState(false);
  const inputStr = msg.input ? JSON.stringify(msg.input, null, 2) : "";
  const hasOutput = msg.output != null;

  return (
    <div className="max-w-[80%] rounded-lg border border-border text-sm w-fit">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 rounded-lg"
      >
        <span className="text-muted-foreground">{open ? "\u25BC" : "\u25B6"}</span>
        <Badge variant="outline" className="font-mono text-xs">
          {msg.tool}
        </Badge>
        {hasOutput ? (
          <Badge variant={msg.isError ? "destructive" : "secondary"} className="text-xs">
            {msg.isError ? "error" : "done"}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground animate-pulse">running...</span>
        )}
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          {inputStr && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Input</div>
              <div className="max-h-40 overflow-y-auto">
                <CodeBlock code={inputStr} language="json" />
              </div>
            </div>
          )}
          {hasOutput && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Output</div>
              <pre className="whitespace-pre-wrap font-mono text-xs bg-muted/50 rounded p-2 max-h-40 overflow-y-auto">
                {msg.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
