/**
 * Performs smooth LiveView navigation without a full page reload.
 * Uses the Phoenix LiveView JS commands API (liveSocket.js().navigate).
 * Falls back to window.location.assign if liveSocket is not available.
 */
export function navigate(href: string, opts?: { replace?: boolean }): void {
  const liveSocket = "liveSocket" in window ? (window as Record<string, unknown>).liveSocket : undefined;
  if (
    liveSocket &&
    typeof liveSocket === "object" &&
    "js" in liveSocket &&
    typeof (liveSocket as Record<string, unknown>).js === "function"
  ) {
    const js = (liveSocket as Record<string, (...args: unknown[]) => unknown>).js() as Record<
      string,
      (href: string, opts?: { replace?: boolean }) => void
    >;
    js.navigate(href, opts);
  } else {
    window.location.assign(href);
  }
}
