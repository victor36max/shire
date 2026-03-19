/**
 * Performs smooth LiveView navigation without a full page reload.
 * Uses the Phoenix LiveView JS commands API (liveSocket.js().navigate).
 * Falls back to window.location.assign if liveSocket is not available.
 */
export function navigate(href: string, opts?: { replace?: boolean }): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const liveSocket = (window as any).liveSocket;
  if (liveSocket?.js) {
    liveSocket.js().navigate(href, opts);
  } else {
    window.location.assign(href);
  }
}
