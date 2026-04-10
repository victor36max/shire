import * as React from "react";
import Markdown from "@/components/Markdown";
import { type Message } from "./types";

export const InterAgentMessage = React.memo(function InterAgentMessage({ msg }: { msg: Message }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="max-w-[80%] rounded-lg border border-border text-sm w-fit">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50 rounded-lg italic"
      >
        <span className="text-muted-foreground">{open ? "\u25BC" : "\u25B6"}</span>
        <span className="text-muted-foreground">Message from {msg.fromAgent}</span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2">
          <Markdown>{msg.text ?? ""}</Markdown>
        </div>
      )}
    </div>
  );
});
