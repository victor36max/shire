import { describe, it, expect } from "bun:test";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import type { MessagesResponse } from "../hooks/messages";
import type { WsSerializedMessage } from "../lib/ws";
import { insertMessageIntoCache } from "../lib/insertMessageIntoCache";

function makeCache(messages: MessagesResponse["messages"]): InfiniteData<MessagesResponse> {
  return {
    pages: [{ messages, hasMore: false }],
    pageParams: [undefined],
  };
}

const wsMsg: WsSerializedMessage = {
  id: 42,
  role: "agent",
  ts: "2026-03-29T00:00:00.000Z",
  text: "Hello world",
};

describe("insertMessageIntoCache", () => {
  it("appends a new message to page 0", () => {
    const qc = new QueryClient();
    qc.setQueryData(["messages", "p1", "a1"], makeCache([]));

    insertMessageIntoCache(qc, "p1", "a1", wsMsg);

    const data = qc.getQueryData<InfiniteData<MessagesResponse>>(["messages", "p1", "a1"]);
    expect(data!.pages[0].messages).toHaveLength(1);
    expect(data!.pages[0].messages[0]).toMatchObject({
      id: 42,
      role: "agent",
      content: { text: "Hello world" },
      createdAt: "2026-03-29T00:00:00.000Z",
    });
  });

  it("skips duplicate messages (same id)", () => {
    const qc = new QueryClient();
    const existing = {
      id: 42,
      projectId: "p1",
      agentId: "a1",
      role: "agent",
      content: { text: "Hello world" },
      createdAt: "2026-03-29T00:00:00.000Z",
    };
    qc.setQueryData(["messages", "p1", "a1"], makeCache([existing]));

    insertMessageIntoCache(qc, "p1", "a1", wsMsg);

    const data = qc.getQueryData<InfiniteData<MessagesResponse>>(["messages", "p1", "a1"]);
    expect(data!.pages[0].messages).toHaveLength(1);
  });

  it("does nothing when cache is empty", () => {
    const qc = new QueryClient();

    insertMessageIntoCache(qc, "p1", "a1", wsMsg);

    const data = qc.getQueryData<InfiniteData<MessagesResponse>>(["messages", "p1", "a1"]);
    expect(data).toBeUndefined();
  });

  it("converts all WsSerializedMessage fields to content fields", () => {
    const qc = new QueryClient();
    qc.setQueryData(["messages", "p1", "a1"], makeCache([]));

    const toolMsg: WsSerializedMessage = {
      id: 99,
      role: "tool_use",
      ts: "2026-03-29T00:00:01.000Z",
      tool: "Read",
      tool_use_id: "tu_123",
      input: { file: "test.ts" },
      output: "file contents",
      isError: false,
    };

    insertMessageIntoCache(qc, "p1", "a1", toolMsg);

    const data = qc.getQueryData<InfiniteData<MessagesResponse>>(["messages", "p1", "a1"]);
    const msg = data!.pages[0].messages[0];
    expect(msg.content).toEqual({
      tool: "Read",
      tool_use_id: "tu_123",
      input: { file: "test.ts" },
      output: "file contents",
      isError: false,
    });
  });

  it("preserves null output (tool still running)", () => {
    const qc = new QueryClient();
    qc.setQueryData(["messages", "p1", "a1"], makeCache([]));

    const toolMsg: WsSerializedMessage = {
      id: 100,
      role: "tool_use",
      ts: "2026-03-29T00:00:02.000Z",
      tool: "Bash",
      tool_use_id: "tu_456",
      input: { command: "ls" },
      output: null,
    };

    insertMessageIntoCache(qc, "p1", "a1", toolMsg);

    const data = qc.getQueryData<InfiniteData<MessagesResponse>>(["messages", "p1", "a1"]);
    expect(data!.pages[0].messages[0].content.output).toBeNull();
  });

  it("preserves existing messages when appending", () => {
    const qc = new QueryClient();
    const existing = {
      id: 1,
      projectId: "p1",
      agentId: "a1",
      role: "user",
      content: { text: "Hi" },
      createdAt: "2026-03-28T00:00:00.000Z",
    };
    qc.setQueryData(["messages", "p1", "a1"], makeCache([existing]));

    insertMessageIntoCache(qc, "p1", "a1", wsMsg);

    const data = qc.getQueryData<InfiniteData<MessagesResponse>>(["messages", "p1", "a1"]);
    expect(data!.pages[0].messages).toHaveLength(2);
    expect(data!.pages[0].messages[0].id).toBe(1);
    expect(data!.pages[0].messages[1].id).toBe(42);
  });
});
