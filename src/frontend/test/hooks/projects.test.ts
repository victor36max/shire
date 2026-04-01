import { describe, it, expect } from "bun:test";
import { http, HttpResponse } from "msw";
import { waitFor, act } from "@testing-library/react";
import { server } from "../msw-server";
import { renderHookWithProviders } from "../test-utils";
import {
  useProjects,
  useCreateProject,
  useDeleteProject,
  useResolveProjectId,
} from "../../hooks/projects";

const projects = [
  { id: "p1", name: "my-project", status: "running" },
  { id: "p2", name: "other-project", status: "running" },
];

describe("useProjects", () => {
  it("fetches and returns project list", async () => {
    server.use(http.get("*/api/projects", () => HttpResponse.json(projects)));
    const { result } = renderHookWithProviders(() => useProjects());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject(projects);
  });
});

describe("useCreateProject", () => {
  it("calls POST and succeeds", async () => {
    const { result } = renderHookWithProviders(() => useCreateProject());
    act(() => result.current.mutate("new-project"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useDeleteProject", () => {
  it("calls DELETE and succeeds", async () => {
    const { result } = renderHookWithProviders(() => useDeleteProject());
    act(() => result.current.mutate("p1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useResolveProjectId", () => {
  it("returns ID for known project name", async () => {
    server.use(http.get("*/api/projects", () => HttpResponse.json(projects)));
    const { result } = renderHookWithProviders(() => useResolveProjectId("my-project"));
    await waitFor(() => expect(result.current).toBe("p1"));
  });

  it("returns undefined for unknown project name", async () => {
    server.use(http.get("*/api/projects", () => HttpResponse.json(projects)));
    const { result } = renderHookWithProviders(() => useResolveProjectId("nonexistent"));
    await waitFor(() => expect(result.current).toBeUndefined());
  });
});
