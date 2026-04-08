import { describe, it, expect } from "bun:test";
import { http, HttpResponse } from "msw";
import { waitFor, act } from "@testing-library/react";
import { server } from "../msw-server";
import { renderHookWithProviders } from "../test-utils";
import {
  useSharedDrive,
  useCreateDirectory,
  useCreateFile,
  useDeleteSharedFile,
} from "../../hooks/shared-drive";

const sharedDriveResponse = {
  files: [
    { name: "readme.txt", path: "/readme.txt", type: "file", size: 128 },
    { name: "docs", path: "/docs", type: "directory", size: 0 },
  ],
  currentPath: "/",
};

describe("useSharedDrive", () => {
  it("fetches with path", async () => {
    server.use(
      http.get("*/api/projects/:id/shared-drive", ({ request }) => {
        const url = new URL(request.url);
        const path = url.searchParams.get("path");
        return HttpResponse.json({ ...sharedDriveResponse, currentPath: path ?? "/" });
      }),
    );
    const { result } = renderHookWithProviders(() => useSharedDrive("p1", "/"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject(sharedDriveResponse);
  });

  it("does not fetch when projectId undefined", () => {
    const { result } = renderHookWithProviders(() => useSharedDrive(undefined, "/"));
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCreateDirectory", () => {
  it("succeeds", async () => {
    const { result } = renderHookWithProviders(() => useCreateDirectory("p1"));
    act(() => result.current.mutate({ name: "new-dir", path: "/" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useCreateFile", () => {
  it("succeeds and returns path", async () => {
    const { result } = renderHookWithProviders(() => useCreateFile("p1"));
    act(() => result.current.mutate({ name: "notes", path: "/" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ ok: true, path: "/test.md" });
  });
});

describe("useDeleteSharedFile", () => {
  it("succeeds", async () => {
    const { result } = renderHookWithProviders(() => useDeleteSharedFile("p1"));
    act(() => result.current.mutate("/readme.txt"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
