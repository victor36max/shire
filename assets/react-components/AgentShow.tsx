import * as React from "react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Input } from "./components/ui/input";
import AppLayout from "./components/AppLayout";
import Markdown from "./components/Markdown";
import Terminal from "./Terminal";
import { type Agent, statusVariant, harnessLabel } from "./types";

interface Message {
  id?: number;
  role: string;
  text?: string;
  ts: string;
  tool?: string;
  tool_use_id?: string;
  input?: Record<string, unknown>;
  output?: string | null;
  is_error?: boolean;
}

function ToolCallMessage({ msg }: { msg: Message }) {
  const [open, setOpen] = React.useState(false);
  const inputStr = msg.input ? JSON.stringify(msg.input, null, 2) : "";
  const hasOutput = msg.output != null;

  return (
    <div className="mr-12 rounded-lg border border-border text-sm">
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

export default function AgentShow({
  agent,
  messages = [],
  hasMore = false,
  loadingMore = false,
  pushEvent,
}: {
  agent: Agent;
  messages?: Message[];
  hasMore?: boolean;
  loadingMore?: boolean;
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}) {
  const [input, setInput] = React.useState("");
  const [activeTab, setActiveTab] = React.useState<"chat" | "terminal">("chat");
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const prevMessagesLengthRef = React.useRef(messages.length);
  const prevScrollHeightRef = React.useRef(0);

  const showTerminalTab = agent.status === "active" || agent.status === "sleeping";

  // Auto-scroll to bottom on new messages (appended at end)
  React.useEffect(() => {
    const prevLen = prevMessagesLengthRef.current;
    const container = scrollContainerRef.current;

    if (messages.length > prevLen && container) {
      // Check if older messages were prepended (scroll height changed but new msgs added at top)
      const prevScrollHeight = prevScrollHeightRef.current;
      if (prevScrollHeight > 0 && container.scrollHeight > prevScrollHeight && container.scrollTop < 50) {
        // Preserve scroll position after prepending older messages
        container.scrollTop = container.scrollHeight - prevScrollHeight;
      } else {
        // New message at the end — scroll to bottom
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    }

    prevMessagesLengthRef.current = messages.length;
  }, [messages]);

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
  };

  const hasMessages = messages.length > 0;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{agent.name}</h1>
            <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => window.location.assign("/")}>
              Back
            </Button>
            {agent.status === "created" || agent.status === "sleeping" || agent.status === "failed" ? (
              <Button onClick={() => pushEvent("start-agent", {})}>Start Agent</Button>
            ) : agent.status === "active" || agent.status === "starting" ? (
              <Button variant="destructive" onClick={() => pushEvent("stop-agent", {})}>
                Stop Agent
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => pushEvent("edit", { id: agent.id })}>
              Edit
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            <dl className="divide-y divide-border">
              <div className="py-3 grid grid-cols-3 gap-4">
                <dt className="text-sm font-medium text-muted-foreground">Name</dt>
                <dd className="text-sm col-span-2">{agent.name}</dd>
              </div>
              <div className="py-3 grid grid-cols-3 gap-4">
                <dt className="text-sm font-medium text-muted-foreground">Model</dt>
                <dd className="text-sm col-span-2">{agent.model || "Not set"}</dd>
              </div>
              <div className="py-3 grid grid-cols-3 gap-4">
                <dt className="text-sm font-medium text-muted-foreground">Harness</dt>
                <dd className="text-sm col-span-2">
                  <Badge variant="outline">{harnessLabel(agent.harness)}</Badge>
                </dd>
              </div>
              <div className="py-3 grid grid-cols-3 gap-4">
                <dt className="text-sm font-medium text-muted-foreground">Status</dt>
                <dd className="text-sm col-span-2">
                  <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
                </dd>
              </div>
              <div className="py-3 grid grid-cols-3 gap-4">
                <dt className="text-sm font-medium text-muted-foreground">System Prompt</dt>
                <dd className="text-sm col-span-2">
                  <pre className="whitespace-pre-wrap font-sans">{agent.system_prompt || "Not set"}</pre>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {(hasMessages || agent.status === "active" || showTerminalTab) && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center gap-1 border-b border-border">
                <button
                  type="button"
                  onClick={() => setActiveTab("chat")}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    activeTab === "chat"
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Chat
                </button>
                {showTerminalTab && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("terminal")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      activeTab === "terminal"
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Terminal
                  </button>
                )}
              </div>

              {activeTab === "chat" ? (
                <>
                  <div
                    ref={scrollContainerRef}
                    onScroll={handleScroll}
                    className="space-y-3 max-h-96 overflow-y-auto"
                  >
                    {loadingMore && (
                      <div className="flex justify-center py-2">
                        <span className="text-xs text-muted-foreground animate-pulse">Loading older messages...</span>
                      </div>
                    )}
                    {!hasMessages && (
                      <p className="text-sm text-muted-foreground">No messages yet. Send a message to talk to the agent.</p>
                    )}
                    {messages.map((msg, i) =>
                      msg.role === "tool_use" ? (
                        <ToolCallMessage key={msg.id ?? `msg-${i}`} msg={msg} />
                      ) : (
                        <div
                          key={msg.id ?? `msg-${i}`}
                          className={`p-3 rounded-lg text-sm ${
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground ml-12"
                              : "bg-muted mr-12"
                          }`}
                        >
                          <Markdown>{msg.text ?? ""}</Markdown>
                        </div>
                      ),
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                  {agent.status === "active" && (
                    <div className="flex gap-2">
                      <Input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Type a message..."
                        onKeyDown={(e) => e.key === "Enter" && handleSend()}
                      />
                      <Button onClick={handleSend}>Send</Button>
                    </div>
                  )}
                </>
              ) : (
                <Terminal pushEvent={pushEvent} />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
