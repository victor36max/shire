import { describe, it, expect, beforeEach, mock, afterEach, type Mock } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { useAuthenticatedUrl } from "./use-authenticated-url";

// Mock getValidToken
const mockGetValidToken = mock(() => Promise.resolve("test-token" as string | null));
mock.module("../lib/api", () => ({
  getValidToken: mockGetValidToken,
}));

// Mock auth store
mock.module("../stores/auth", () => ({
  useAuthStore: {
    getState: () => ({
      refreshAccessToken: () => Promise.resolve("refreshed-token"),
    }),
  },
}));

let mockFetch: Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;
let mockRevokeObjectURL: Mock<(url: string) => void>;

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  mockGetValidToken.mockImplementation(() => Promise.resolve("test-token" as string | null));

  URL.createObjectURL = (_blob: Blob | MediaSource) => {
    return `blob:http://localhost/${Math.random().toString(36).slice(2)}`;
  };
  mockRevokeObjectURL = mock((_url: string) => {});
  URL.revokeObjectURL = mockRevokeObjectURL;

  mockFetch = mock(async () => {
    return new Response(new Blob(["fake-image-data"], { type: "image/png" }), { status: 200 });
  });
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

describe("useAuthenticatedUrl", () => {
  it("returns null blobUrl when url is null", () => {
    const { result } = renderHook(() => useAuthenticatedUrl(null));
    expect(result.current.blobUrl).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("fetches with auth header and returns blob URL", async () => {
    const { result } = renderHook(() => useAuthenticatedUrl("/api/test/download"));

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.blobUrl).toMatch(/^blob:/);
    expect(result.current.error).toBeNull();

    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toBe("/api/test/download");
    expect((fetchCall[1]?.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token",
    );
  });

  it("fetches without auth header when token is null", async () => {
    mockGetValidToken.mockImplementation(() => Promise.resolve(null));

    const { result } = renderHook(() => useAuthenticatedUrl("/api/test/download"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.blobUrl).toMatch(/^blob:/);
    const fetchCall = mockFetch.mock.calls[0];
    expect((fetchCall[1]?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("sets error on non-ok response", async () => {
    mockFetch.mockImplementation(async () => {
      return new Response("Not Found", { status: 404 });
    });

    const { result } = renderHook(() => useAuthenticatedUrl("/api/test/download"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.blobUrl).toBeNull();
    expect(result.current.error).toBe("Failed to load resource (404)");
  });

  it("retries on 401 with refreshed token", async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("Unauthorized", { status: 401 });
      }
      return new Response(new Blob(["data"]), { status: 200 });
    });

    const { result } = renderHook(() => useAuthenticatedUrl("/api/test/download"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.blobUrl).toMatch(/^blob:/);
    expect(callCount).toBe(2);

    const secondCall = mockFetch.mock.calls[1];
    expect((secondCall[1]?.headers as Record<string, string>).Authorization).toBe(
      "Bearer refreshed-token",
    );
  });

  it("revokes blob URL on unmount", async () => {
    const { result, unmount } = renderHook(() => useAuthenticatedUrl("/api/test/download"));

    await waitFor(() => {
      expect(result.current.blobUrl).not.toBeNull();
    });

    const blobUrl = result.current.blobUrl;
    unmount();

    expect(mockRevokeObjectURL).toHaveBeenCalledWith(blobUrl);
  });

  it("resets state when url changes to null", async () => {
    const { result, rerender } = renderHook(
      ({ url }: { url: string | null }) => useAuthenticatedUrl(url),
      { initialProps: { url: "/api/test/download" as string | null } },
    );

    await waitFor(() => {
      expect(result.current.blobUrl).not.toBeNull();
    });

    rerender({ url: null });

    expect(result.current.blobUrl).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
