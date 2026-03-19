import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { navigate } from "../react-components/lib/navigate";

const win = window as unknown as Record<string, unknown>;

describe("navigate", () => {
  const originalLiveSocket = win.liveSocket;
  let assignSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { assign: assignSpy },
      writable: true,
    });
  });

  afterEach(() => {
    win.liveSocket = originalLiveSocket;
  });

  it("calls liveSocket.js().navigate() when liveSocket is available", () => {
    const navigateFn = vi.fn();
    win.liveSocket = {
      js: () => ({ navigate: navigateFn }),
    };

    navigate("/projects/test");

    expect(navigateFn).toHaveBeenCalledWith("/projects/test", undefined);
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("passes replace option through to liveSocket", () => {
    const navigateFn = vi.fn();
    win.liveSocket = {
      js: () => ({ navigate: navigateFn }),
    };

    navigate("/projects/test", { replace: true });

    expect(navigateFn).toHaveBeenCalledWith("/projects/test", { replace: true });
  });

  it("falls back to window.location.assign when liveSocket is not available", () => {
    win.liveSocket = undefined;

    navigate("/projects/test");

    expect(assignSpy).toHaveBeenCalledWith("/projects/test");
  });

  it("falls back to window.location.assign when liveSocket has no js method", () => {
    win.liveSocket = {};

    navigate("/projects/test");

    expect(assignSpy).toHaveBeenCalledWith("/projects/test");
  });
});
