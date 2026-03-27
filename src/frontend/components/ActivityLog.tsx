import * as React from "react";
import { Button } from "./ui/button";
import { Clock } from "lucide-react";
import type { InterAgentMessage } from "./types";

interface ActivityLogProps {
  messages: InterAgentMessage[];
  hasMore: boolean;
  onLoadMore: (before: number) => void;
}

export default function ActivityLog({ messages, hasMore, onLoadMore }: ActivityLogProps) {
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
      onLoadMore(oldestId);
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
                {msg.trigger === "scheduled_task" ? (
                  <>
                    <Clock className="inline h-3 w-3 mr-1" />
                    <span className="font-medium text-foreground">{msg.taskLabel}</span>
                  </>
                ) : (
                  <>
                    <span className="font-medium text-foreground">{msg.fromAgent}</span>
                    {" \u2192 "}
                    <span className="font-medium text-foreground">{msg.toAgent}</span>
                  </>
                )}
              </span>
              <time>{new Date(msg.ts).toLocaleString()}</time>
            </div>
            <p className="text-sm whitespace-pre-wrap">{displayText}</p>
            {isLong && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => toggleExpand(msg.id)}
              >
                {isExpanded ? "Show less" : "Show more"}
              </Button>
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
