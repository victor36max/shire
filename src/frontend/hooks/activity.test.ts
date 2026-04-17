import { describe, it, expect } from "bun:test";
import { http, HttpResponse } from "msw";
import { waitFor } from "@testing-library/react";
import { server } from "../test/msw-server";
import { renderHookWithProviders } from "../test/test-utils";
import { useActivity } from "./activity";

describe("useActivity", () => {
  it("fetches when projectId provided", async () => {
    const activityResponse = {
      messages: [{ id: 1 }, { id: 2 }],
      hasMore: false,
    };
    server.use(http.get("*/api/projects/:id/activity", () => HttpResponse.json(activityResponse)));
    const { result } = renderHookWithProviders(() => useActivity("p1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0]).toMatchObject(activityResponse);
  });

  it("does not fetch when projectId undefined", () => {
    const { result } = renderHookWithProviders(() => useActivity(undefined));
    expect(result.current.fetchStatus).toBe("idle");
  });
});
