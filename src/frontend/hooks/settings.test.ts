import { describe, it, expect } from "bun:test";
import { http, HttpResponse } from "msw";
import { waitFor, act } from "@testing-library/react";
import { server } from "../test/msw-server";
import { renderHookWithProviders } from "../test/test-utils";
import { useProjectDoc, useSaveProjectDoc } from "./settings";

const doc = { content: "# My Project\n\nProject documentation here." };

describe("useProjectDoc", () => {
  it("fetches when projectId is provided", async () => {
    server.use(http.get("*/api/projects/:id/settings/project-doc", () => HttpResponse.json(doc)));
    const { result } = renderHookWithProviders(() => useProjectDoc("p1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject(doc);
  });

  it("does not fetch when projectId is undefined", async () => {
    const { result } = renderHookWithProviders(() => useProjectDoc(undefined));
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useSaveProjectDoc", () => {
  it("calls PUT and succeeds", async () => {
    const { result } = renderHookWithProviders(() => useSaveProjectDoc("p1"));
    act(() => result.current.mutate("# Updated doc content"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
