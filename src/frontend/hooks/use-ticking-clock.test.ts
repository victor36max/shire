import { describe, it, expect, jest, beforeEach, afterEach } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useTickingClock } from "../hooks/use-ticking-clock";

describe("useTickingClock", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns initial tick value of 0", () => {
    const { result } = renderHook(() => useTickingClock(1000));
    expect(result.current).toBe(0);
  });

  it("increments tick after interval", () => {
    const { result } = renderHook(() => useTickingClock(1000));
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(1);

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(2);
  });

  it("clears interval on unmount", () => {
    const { result, unmount } = renderHook(() => useTickingClock(500));
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(result.current).toBe(1);

    unmount();

    // After unmount, the interval should be cleared.
    // No errors should occur from ticking after unmount.
    act(() => {
      jest.advanceTimersByTime(1500);
    });
  });
});
