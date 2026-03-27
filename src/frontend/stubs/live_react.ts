// Stub for live_react — used during the migration period
// until ChatPanel and Terminal are rewritten to use WebSocket hooks
export function useLiveReact() {
  return {
    handleEvent: () => "ref-id",
    removeHandleEvent: () => {},
    pushEvent: () => {},
    pushEventTo: () => {},
    upload: () => {},
    uploadTo: () => {},
  };
}
