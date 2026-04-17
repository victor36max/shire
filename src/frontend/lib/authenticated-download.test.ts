import { describe, it, expect, beforeEach, mock, type Mock } from "bun:test";
import { authenticatedDownload } from "./authenticated-download";

// Mock getValidToken
const mockGetValidToken = mock(() => Promise.resolve("test-token" as string | null));
mock.module("./api", () => ({
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

beforeEach(() => {
  mockGetValidToken.mockImplementation(() => Promise.resolve("test-token" as string | null));

  URL.createObjectURL = mock((_blob: Blob | MediaSource) => "blob:http://localhost/fake-blob");
  URL.revokeObjectURL = mock((_url: string) => {});

  mockFetch = mock(async () => {
    return new Response(new Blob(["file-content"]), { status: 200 });
  });
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

describe("authenticatedDownload", () => {
  it("fetches with auth header and triggers download", async () => {
    const clickMock = mock(() => {});
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") {
        el.click = clickMock;
      }
      return el;
    }) as unknown as typeof document.createElement;
    document.body.appendChild = ((_node: unknown) =>
      _node) as unknown as typeof document.body.appendChild;
    document.body.removeChild = ((_node: unknown) =>
      _node) as unknown as typeof document.body.removeChild;

    await authenticatedDownload("/api/test/download", "test-file.png");

    // Verify fetch was called with auth
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toBe("/api/test/download");
    expect((fetchCall[1]?.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token",
    );

    // Verify download was triggered
    expect(clickMock).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/fake-blob");
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockImplementation(async () => {
      return new Response("Not Found", { status: 404 });
    });

    await expect(authenticatedDownload("/api/test/download", "file.png")).rejects.toThrow(
      "Download failed (404)",
    );
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

    const clickMock = mock(() => {});
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") el.click = clickMock;
      return el;
    }) as unknown as typeof document.createElement;
    document.body.appendChild = ((_node: unknown) =>
      _node) as unknown as typeof document.body.appendChild;
    document.body.removeChild = ((_node: unknown) =>
      _node) as unknown as typeof document.body.removeChild;

    await authenticatedDownload("/api/test/download", "file.png");

    expect(callCount).toBe(2);
    const secondCall = mockFetch.mock.calls[1];
    expect((secondCall[1]?.headers as Record<string, string>).Authorization).toBe(
      "Bearer refreshed-token",
    );
    expect(clickMock).toHaveBeenCalled();
  });

  it("works without auth when token is null", async () => {
    mockGetValidToken.mockImplementation(() => Promise.resolve(null));

    const clickMock = mock(() => {});
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") el.click = clickMock;
      return el;
    }) as unknown as typeof document.createElement;
    document.body.appendChild = ((_node: unknown) =>
      _node) as unknown as typeof document.body.appendChild;
    document.body.removeChild = ((_node: unknown) =>
      _node) as unknown as typeof document.body.removeChild;

    await authenticatedDownload("/api/test/download", "file.png");

    const fetchCall = mockFetch.mock.calls[0];
    expect((fetchCall[1]?.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(clickMock).toHaveBeenCalled();
  });
});
