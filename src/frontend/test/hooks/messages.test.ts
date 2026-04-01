import { describe, it, expect } from "bun:test";
import { http, HttpResponse } from "msw";
import { waitFor, act } from "@testing-library/react";
import { server } from "../msw-server";
import { renderHookWithProviders } from "../test-utils";
import {
  useMessages,
  useSendMessage,
  useInterruptAgent,
  useMarkRead,
  useClearSession,
} from "../../hooks/messages";

const messagesResponse = {
  messages: [
    {
      id: 1,
      projectId: "p1",
      agentId: "a1",
      role: "user",
      content: { text: "hello" },
      createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: 2,
      projectId: "p1",
      agentId: "a1",
      role: "assistant",
      content: { text: "hi there" },
      createdAt: "2026-01-01T00:00:01Z",
    },
  ],
  hasMore: false,
};

describe("useMessages", () => {
  it("fetches when both IDs provided", async () => {
    server.use(
      http.get("*/api/projects/:id/agents/:aid/messages", () =>
        HttpResponse.json(messagesResponse),
      ),
    );
    const { result } = renderHookWithProviders(() => useMessages("p1", "a1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0]).toMatchObject(messagesResponse);
  });

  it("does not fetch when projectId undefined", () => {
    const { result } = renderHookWithProviders(() => useMessages(undefined, "a1"));
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useSendMessage", () => {
  it("succeeds with attachmentIds", async () => {
    const { result } = renderHookWithProviders(() => useSendMessage("p1"));
    act(() =>
      result.current.mutate({
        agentId: "a1",
        text: "hello",
        attachmentIds: ["att-1"],
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useInterruptAgent", () => {
  it("succeeds", async () => {
    const { result } = renderHookWithProviders(() => useInterruptAgent("p1"));
    act(() => result.current.mutate("a1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useMarkRead", () => {
  it("succeeds", async () => {
    const { result } = renderHookWithProviders(() => useMarkRead("p1"));
    act(() => result.current.mutate({ agentId: "a1", messageId: 2 }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useClearSession", () => {
  it("succeeds", async () => {
    const { result } = renderHookWithProviders(() => useClearSession("p1"));
    act(() => result.current.mutate("a1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
