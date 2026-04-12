import { useSyncExternalStore } from "react";

const DESKTOP_MQ = "(min-width: 768px)";

export function useIsDesktop() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(DESKTOP_MQ);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(DESKTOP_MQ).matches,
    () => true,
  );
}
