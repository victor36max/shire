import * as React from "react";
import { Button } from "./ui/button";
import { Clock, Loader2 } from "lucide-react";
import type { InterAgentMessage } from "./types";

interface ActivityLogProps {
  messages: InterAgentMessage[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

export default function ActivityLog({
  messages,
  hasMore,
  loadingMore,
  onLoadMore,
}: ActivityLogProps) {
  const [expandedIds, setExpandedIds] = React.useState<Set<number>>(new Set());
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);

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

  const handleScroll = React.useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !hasMore || loadingMore) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (nearBottom && messages.length > 0) {
      onLoadMore();
    }
  }, [hasMore, loadingMore, messages.length, onLoadMore]);

  // Auto-load next page when content doesn't overflow the scroll container
  React.useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !hasMore || loadingMore || messages.length === 0) return;
    if (container.scrollHeight <= container.clientHeight) {
      onLoadMore();
    }
  }, [hasMore, loadingMore, messages.length, onLoadMore]);

  if (messages.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        No inter-agent messages yet. Messages between agents will appear here.
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="space-y-2 overflow-y-auto max-h-[calc(100vh-16rem)]"
    >
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
                    {" → "}
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
                aria-expanded={isExpanded}
                className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => toggleExpand(msg.id)}
              >
                {isExpanded ? "Show less" : "Show more"}
              </Button>
            )}
          </div>
        );
      })}
      {loadingMore && (
        <div className="flex justify-center py-2">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
