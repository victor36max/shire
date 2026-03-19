import * as React from "react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import Markdown from "./components/Markdown";
import { type Agent } from "./types";

export interface Message {
  id?: number;
  role: string;
  text?: string;
  ts: string;
  tool?: string;
  tool_use_id?: string;
  input?: Record<string, unknown>;
  output?: string | null;
  is_error?: boolean;
  from_agent?: string;
}

function ToolCallMessage({ msg }: { msg: Message }) {
  const [open, setOpen] = React.useState(false);
  const inputStr = msg.input ? JSON.stringify(msg.input, null, 2) : "";
  const hasOutput = msg.output != null;

  return (
    <div className="max-w-[80%] rounded-lg border border-border text-sm w-fit">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 rounded-lg"
      >
        <span className="text-muted-foreground">{open ? "\u25BC" : "\u25B6"}</span>
        <Badge variant="outline" className="font-mono text-xs">
          {msg.tool}
        </Badge>
        {hasOutput ? (
          <Badge variant={msg.is_error ? "destructive" : "secondary"} className="text-xs">
            {msg.is_error ? "error" : "done"}
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
              <pre className="whitespace-pre-wrap font-mono text-xs bg-muted/50 rounded p-2 max-h-40 overflow-y-auto">
                {inputStr}
              </pre>
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
}

function InterAgentMessage({ msg }: { msg: Message }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="max-w-[80%] rounded-lg border border-border text-sm w-fit">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50 rounded-lg italic"
      >
        <span className="text-muted-foreground">{open ? "\u25BC" : "\u25B6"}</span>
        <span className="text-muted-foreground">Message from {msg.from_agent}</span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2">
          <Markdown>{msg.text ?? ""}</Markdown>
        </div>
      )}
    </div>
  );
}

interface ChatPanelProps {
  agent: Agent;
  messages?: Message[];
  hasMore?: boolean;
  loadingMore?: boolean;
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}

export default function ChatPanel({
  agent,
  messages = [],
  hasMore = false,
  loadingMore = false,
  pushEvent,
}: ChatPanelProps) {
  const [input, setInput] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const prevMessagesLengthRef = React.useRef(0);
  const prevScrollHeightRef = React.useRef(0);
  const initialScrollDone = React.useRef(false);

  // Auto-scroll to bottom on initial load and new messages
  React.useEffect(() => {
    const prevLen = prevMessagesLengthRef.current;
    const container = scrollContainerRef.current;

    if (container && messages.length > 0) {
      if (!initialScrollDone.current) {
        // Initial load — scroll to bottom immediately
        initialScrollDone.current = true;
        messagesEndRef.current?.scrollIntoView();
      } else if (messages.length > prevLen) {
        const prevScrollHeight = prevScrollHeightRef.current;
        if (prevScrollHeight > 0 && container.scrollHeight > prevScrollHeight && container.scrollTop < 50) {
          // Preserve scroll position after prepending older messages
          container.scrollTop = container.scrollHeight - prevScrollHeight;
        } else {
          // New message at the end — scroll to bottom
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
      }
    }

    prevMessagesLengthRef.current = messages.length;
  }, [messages]);

  // Scroll to bottom when busy state changes (thinking indicator appears/disappears)
  React.useEffect(() => {
    if (agent.busy && initialScrollDone.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [agent.busy]);

  // Save scroll height before render for scroll position preservation
  React.useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      prevScrollHeightRef.current = container.scrollHeight;
    }
  });

  // Infinite scroll: load more when scrolled to top
  const handleScroll = React.useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !hasMore || loadingMore) return;
    if (container.scrollTop === 0) {
      pushEvent("load-more", {});
    }
  }, [hasMore, loadingMore, pushEvent]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    pushEvent("send-message", { text });
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-3">
        {loadingMore && (
          <div className="flex justify-center py-2">
            <span className="text-xs text-muted-foreground animate-pulse">Loading older messages...</span>
          </div>
        )}
        {!hasMessages && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">No messages yet. Send a message to talk to the agent.</p>
          </div>
        )}
        {messages.map((msg, i) =>
          msg.role === "tool_use" ? (
            <ToolCallMessage key={msg.id ?? `msg-${i}`} msg={msg} />
          ) : msg.role === "inter_agent" ? (
            <InterAgentMessage key={msg.id ?? `msg-${i}`} msg={msg} />
          ) : (
            <div key={msg.id ?? `msg-${i}`} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`px-3 py-1.5 rounded-lg text-sm w-fit max-w-[80%] ${
                  msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                <Markdown className={msg.role === "user" ? "prose-invert" : ""}>{msg.text ?? ""}</Markdown>
              </div>
            </div>
          ),
        )}
        {agent.busy && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      {agent.status === "active" ? (
        <div className="border-t border-border p-4">
          <div className="flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px";
              }}
              placeholder="Type a message..."
              rows={1}
              className="min-h-0 resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <Button onClick={handleSend}>Send</Button>
          </div>
        </div>
      ) : agent.status === "idle" ? (
        <div className="border-t border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Agent is idle. It will restart automatically when the VM wakes up.
            </p>
            <Button variant="outline" size="sm" onClick={() => pushEvent("restart-agent", {})}>
              Restart
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
