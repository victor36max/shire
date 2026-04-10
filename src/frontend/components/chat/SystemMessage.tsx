import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Markdown from "@/components/Markdown";
import { type Message } from "./types";

export const SystemMessage = React.memo(function SystemMessage({ msg }: { msg: Message }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="max-w-[80%] rounded-lg border border-border text-sm w-fit">
      <Button
        variant="ghost"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left italic h-auto justify-start"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-muted-foreground">System notification</span>
      </Button>
      {open && (
        <div className="border-t border-border px-3 py-2">
          <Markdown>{msg.text ?? ""}</Markdown>
        </div>
      )}
    </div>
  );
});
