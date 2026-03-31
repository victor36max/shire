import { useState, useEffect } from "react";

/** Re-renders the consuming component at a fixed interval. */
export function useTickingClock(intervalMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}
