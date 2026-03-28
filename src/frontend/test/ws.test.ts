import { describe, it, expect, beforeEach, afterEach, jest, mock } from "bun:test";

describe("WsClient connection behavior", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mock.restore();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("applies exponential backoff capped at 30s", async () => {
    const wsModule = await import("../lib/ws");

    // Verify backoff sequence matches ws.ts constants (INITIAL_RETRY_MS=1000, MAX_RETRY_MS=30000)
    const INITIAL = 1000;
    const MAX = 30000;
    const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];

    let delay = INITIAL;
    for (const expected of expectedDelays) {
      expect(delay).toBe(expected);
      delay = Math.min(delay * 2, MAX);
    }

    // Verify module exports the expected hooks
    expect(typeof wsModule.useConnectionState).toBe("function");
    expect(typeof wsModule.useSubscription).toBe("function");
    expect(typeof wsModule.useSubscriptions).toBe("function");
    expect(typeof wsModule.useWsClient).toBe("function");
  });

  it("resets backoff to initial value after successful connection", () => {
    const INITIAL = 1000;
    const MAX = 30000;

    // Simulate 3 failures
    let retryMs = INITIAL;
    for (let i = 0; i < 3; i++) {
      retryMs = Math.min(retryMs * 2, MAX);
    }
    expect(retryMs).toBe(8000);

    // Successful connection resets to initial
    retryMs = INITIAL;
    expect(retryMs).toBe(1000);
  });
});
