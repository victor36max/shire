import { describe, it, expect } from "bun:test";
import { http, HttpResponse } from "msw";
import { waitFor, act } from "@testing-library/react";
import { server } from "../test/msw-server";
import { renderHookWithProviders } from "../test/test-utils";
import { useSchedules, useCreateSchedule, useDeleteSchedule, useToggleSchedule } from "./schedules";

const schedules = [
  {
    id: "s1",
    projectId: "p1",
    agentId: "a1",
    label: "Daily review",
    message: "Review PRs",
    scheduleType: "recurring",
    cronExpression: "0 9 * * *",
    enabled: true,
  },
];

describe("useSchedules", () => {
  it("fetches when projectId is provided", async () => {
    server.use(http.get("*/api/projects/:id/schedules", () => HttpResponse.json(schedules)));
    const { result } = renderHookWithProviders(() => useSchedules("p1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject(schedules);
  });

  it("does not fetch when projectId is undefined", async () => {
    const { result } = renderHookWithProviders(() => useSchedules(undefined));
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCreateSchedule", () => {
  it("calls POST and succeeds", async () => {
    const { result } = renderHookWithProviders(() => useCreateSchedule("p1"));
    act(() =>
      result.current.mutate({
        agentId: "a1",
        label: "New schedule",
        message: "Do something",
        scheduleType: "recurring",
        cronExpression: "0 12 * * *",
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useDeleteSchedule", () => {
  it("calls DELETE and succeeds", async () => {
    const { result } = renderHookWithProviders(() => useDeleteSchedule("p1"));
    act(() => result.current.mutate("s1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useToggleSchedule", () => {
  it("calls POST toggle and succeeds", async () => {
    const { result } = renderHookWithProviders(() => useToggleSchedule("p1"));
    act(() => result.current.mutate({ id: "s1", enabled: false }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
