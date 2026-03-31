import { useState, useEffect } from "react";

/** Re-renders the consuming component at a fixed interval (default 60s). */
export function useTickingClock(intervalMs = 60_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}
