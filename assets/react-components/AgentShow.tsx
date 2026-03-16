import * as React from "react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Input } from "./components/ui/input";
import AppLayout from "./components/AppLayout";
import { type Agent, statusVariant, harnessLabel } from "./types";

interface Message {
  role: string;
  text: string;
  ts: string;
}

export default function AgentShow({
  agent,
  messages = [],
  pushEvent,
}: {
  agent: Agent;
  messages?: Message[];
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}) {
  const [input, setInput] = React.useState("");
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    pushEvent("send-message", { text });
    setInput("");
  };

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

        {agent.status === "active" && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <h2 className="text-lg font-semibold">Chat</h2>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {messages.length === 0 && (
                  <p className="text-sm text-muted-foreground">No messages yet. Send a message to talk to the agent.</p>
                )}
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`p-3 rounded-lg text-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground ml-12"
                        : "bg-muted mr-12"
                    }`}
                  >
                    <pre className="whitespace-pre-wrap font-sans">{msg.text}</pre>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <div className="flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type a message..."
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                />
                <Button onClick={handleSend}>Send</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
