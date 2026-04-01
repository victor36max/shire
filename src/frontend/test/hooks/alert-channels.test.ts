import { describe, it, expect } from "bun:test";
import { http, HttpResponse } from "msw";
import { waitFor, act } from "@testing-library/react";
import { server } from "../msw-server";
import { renderHookWithProviders } from "../test-utils";
import {
  useAlertChannel,
  useUpsertAlertChannel,
  useDeleteAlertChannel,
} from "../../hooks/alert-channels";

const channel = {
  id: "ch1",
  projectId: "p1",
  type: "slack",
  config: { webhookUrl: "https://hooks.slack.com/test" },
  enabled: true,
};

describe("useAlertChannel", () => {
  it("fetches channel data", async () => {
    server.use(http.get("*/api/projects/:id/alert-channel", () => HttpResponse.json(channel)));
    const { result } = renderHookWithProviders(() => useAlertChannel("p1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject(channel);
  });

  it("returns null on 404", async () => {
    const { result } = renderHookWithProviders(() => useAlertChannel("p1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("does not fetch when projectId is undefined", async () => {
    const { result } = renderHookWithProviders(() => useAlertChannel(undefined));
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useUpsertAlertChannel", () => {
  it("calls PUT and succeeds", async () => {
    const { result } = renderHookWithProviders(() => useUpsertAlertChannel("p1"));
    act(() =>
      result.current.mutate({
        config: { type: "slack", webhookUrl: "https://hooks.slack.com/test" },
        enabled: true,
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useDeleteAlertChannel", () => {
  it("calls DELETE and succeeds", async () => {
    const { result } = renderHookWithProviders(() => useDeleteAlertChannel("p1"));
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
