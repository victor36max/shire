import * as React from "react";
import { Button } from "./components/ui/button";
import type { InterAgentMessage } from "./types";

interface ActivityLogProps {
  messages: InterAgentMessage[];
  hasMore: boolean;
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}

export default function ActivityLog({ messages, hasMore, pushEvent }: ActivityLogProps) {
  const [expandedIds, setExpandedIds] = React.useState<Set<number>>(new Set());

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleLoadMore = () => {
    const oldestId = messages[messages.length - 1]?.id;
    if (oldestId) {
      pushEvent("load-more-messages", { before: oldestId });
    }
  };

  if (messages.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        No inter-agent messages yet. Messages between agents will appear here.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {messages.map((msg) => {
        const isExpanded = expandedIds.has(msg.id);
        const isLong = msg.text.length > 200;
        const displayText = isLong && !isExpanded ? msg.text.slice(0, 200) + "..." : msg.text;

        return (
          <div key={msg.id} className="border rounded-lg p-3 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">{msg.from_agent}</span>
                {" \u2192 "}
                <span className="font-medium text-foreground">{msg.to_agent}</span>
              </span>
              <time>{new Date(msg.ts).toLocaleString()}</time>
            </div>
            <p className="text-sm whitespace-pre-wrap">{displayText}</p>
            {isLong && (
              <button
                onClick={() => toggleExpand(msg.id)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {isExpanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        );
      })}
      {hasMore && (
        <div className="text-center pt-2">
          <Button variant="outline" size="sm" onClick={handleLoadMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
