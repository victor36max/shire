import { describe, it, expect } from "bun:test";
import { http, HttpResponse } from "msw";
import { waitFor, act } from "@testing-library/react";
import { server } from "../msw-server";
import { renderHookWithProviders } from "../test-utils";
import {
  useAgents,
  useAgentDetail,
  useCreateAgent,
  useUpdateAgent,
  useDeleteAgent,
  useRestartAgent,
} from "../../hooks/agents";

const agentListResponse = {
  agents: [
    { id: "a1", name: "agent-one", status: "running", lastUserMessageAt: null },
    { id: "a2", name: "agent-two", status: "idle", lastUserMessageAt: null },
  ],
  defaultAgentId: null,
};

const agentDetail = {
  id: "a1",
  name: "agent-one",
  status: "running",
  harness: "claude_code",
  systemPrompt: "You are helpful.",
};

describe("useAgents", () => {
  it("fetches when projectId provided", async () => {
    server.use(http.get("*/api/projects/:id/agents", () => HttpResponse.json(agentListResponse)));
    const { result } = renderHookWithProviders(() => useAgents("p1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject(agentListResponse);
  });

  it("does not fetch when projectId undefined", () => {
    const { result } = renderHookWithProviders(() => useAgents(undefined));
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useAgentDetail", () => {
  it("fetches when both IDs provided", async () => {
    server.use(http.get("*/api/projects/:id/agents/:aid", () => HttpResponse.json(agentDetail)));
    const { result } = renderHookWithProviders(() => useAgentDetail("p1", "a1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject(agentDetail);
  });

  it("does not fetch when agentId undefined", () => {
    const { result } = renderHookWithProviders(() => useAgentDetail("p1", undefined));
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCreateAgent", () => {
  it("succeeds", async () => {
    const { result } = renderHookWithProviders(() => useCreateAgent("p1"));
    act(() => result.current.mutate({ name: "new-agent" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useUpdateAgent", () => {
  it("succeeds", async () => {
    const { result } = renderHookWithProviders(() => useUpdateAgent("p1"));
    act(() => result.current.mutate({ id: "a1", name: "updated-agent" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useDeleteAgent", () => {
  it("succeeds", async () => {
    const { result } = renderHookWithProviders(() => useDeleteAgent("p1"));
    act(() => result.current.mutate("a1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useRestartAgent", () => {
  it("succeeds", async () => {
    const { result } = renderHookWithProviders(() => useRestartAgent("p1"));
    act(() => result.current.mutate("a1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
