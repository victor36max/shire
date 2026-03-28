import { describe, it, expect, beforeEach, mock } from "bun:test";
import { navigate, setNavigate } from "../lib/navigate";

describe("navigate", () => {
  beforeEach(() => {
    // Reset the navigate callback
    setNavigate(null as unknown as (href: string) => void);
  });

  it("uses setNavigate callback when available", () => {
    const mockNav = mock(() => {});
    setNavigate(mockNav);

    navigate("/projects/test");
    expect(mockNav).toHaveBeenCalledWith("/projects/test", undefined);
  });

  it("passes replace option through", () => {
    const mockNav = mock(() => {});
    setNavigate(mockNav);

    navigate("/projects/test", { replace: true });
    expect(mockNav).toHaveBeenCalledWith("/projects/test", { replace: true });
  });

  it("falls back to window.location.assign when no callback set", () => {
    const assignSpy = mock(() => {});
    Object.defineProperty(window, "location", {
      value: { assign: assignSpy },
      writable: true,
    });

    navigate("/projects/test");
    expect(assignSpy).toHaveBeenCalledWith("/projects/test");
  });
});
