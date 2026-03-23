import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Override the global useLiveReact mock with test-local fns we can inspect
const mockHandleEvent = vi.fn().mockReturnValue("ref-id");
const mockRemoveHandleEvent = vi.fn();

vi.mock("live_react", () => ({
  useLiveReact: () => ({
    handleEvent: mockHandleEvent,
    removeHandleEvent: mockRemoveHandleEvent,
    pushEvent: vi.fn(),
    pushEventTo: vi.fn(),
    upload: vi.fn(),
    uploadTo: vi.fn(),
  }),
}));

// Mock xterm — jsdom doesn't support canvas
const mockWrite = vi.fn();
const mockWriteln = vi.fn();
const mockDispose = vi.fn();
const mockLoadAddon = vi.fn();
const mockOnData = vi.fn().mockReturnValue({ dispose: vi.fn() });
const mockOpen = vi.fn();
const mockClear = vi.fn();
const mockFocus = vi.fn();

vi.mock("@xterm/xterm", () => {
  class MockTerminal {
    open = mockOpen;
    write = mockWrite;
    writeln = mockWriteln;
    dispose = mockDispose;
    loadAddon = mockLoadAddon;
    onData = mockOnData;
    clear = mockClear;
    focus = mockFocus;
    rows = 24;
    cols = 80;
  }
  return { Terminal: MockTerminal };
});

vi.mock("@xterm/addon-fit", () => {
  class MockFitAddon {
    fit = vi.fn();
  }
  return { FitAddon: MockFitAddon };
});

import Terminal, { LocalEchoPredictor } from "../react-components/Terminal";
import { Terminal as XTerm } from "@xterm/xterm";

describe("Terminal", () => {
  const pushEvent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockHandleEvent.mockReturnValue("ref-id");
  });

  it("renders terminal container", () => {
    render(<Terminal pushEvent={pushEvent} />);
    expect(mockOpen).toHaveBeenCalled();
  });

  it("calls connect-terminal on mount", () => {
    render(<Terminal pushEvent={pushEvent} />);
    expect(pushEvent).toHaveBeenCalledWith("connect-terminal", {});
  });

  it("registers handleEvent listeners for output and exit", () => {
    render(<Terminal pushEvent={pushEvent} />);
    expect(mockHandleEvent).toHaveBeenCalledWith("terminal-output", expect.any(Function));
    expect(mockHandleEvent).toHaveBeenCalledWith("terminal-exit", expect.any(Function));
  });

  it("calls disconnect-terminal and cleans up on unmount", () => {
    const { unmount } = render(<Terminal pushEvent={pushEvent} />);
    unmount();
    expect(pushEvent).toHaveBeenCalledWith("disconnect-terminal", {});
    expect(mockRemoveHandleEvent).toHaveBeenCalledTimes(2);
    expect(mockDispose).toHaveBeenCalled();
  });

  it("forwards terminal input via pushEvent", () => {
    render(<Terminal pushEvent={pushEvent} />);
    const onDataCallback = mockOnData.mock.calls[0][0];
    onDataCallback("a");
    expect(pushEvent).toHaveBeenCalledWith("terminal-input", { data: "a" });
  });

  it("writes printable input in dim style for local echo", () => {
    render(<Terminal pushEvent={pushEvent} />);
    const onDataCallback = mockOnData.mock.calls[0][0];
    onDataCallback("a");
    expect(mockWrite).toHaveBeenCalledWith("\x1b[2ma\x1b[22m");
  });

  it("does not predict control characters", () => {
    render(<Terminal pushEvent={pushEvent} />);
    const onDataCallback = mockOnData.mock.calls[0][0];
    mockWrite.mockClear();
    onDataCallback("\x03"); // Ctrl+C
    // Should not write dim prediction (only pushEvent)
    expect(mockWrite).not.toHaveBeenCalledWith(expect.stringContaining("\x1b[2m"));
  });

  it("shows reconnect button on terminal exit", () => {
    render(<Terminal pushEvent={pushEvent} />);
    const exitCall = mockHandleEvent.mock.calls.find((call: unknown[]) => call[0] === "terminal-exit")!;
    act(() => {
      exitCall[1]({ code: 0 });
    });
    expect(screen.getByText("Reconnect")).toBeInTheDocument();
  });

  it("reconnects when clicking Reconnect", async () => {
    render(<Terminal pushEvent={pushEvent} />);
    const exitCall = mockHandleEvent.mock.calls.find((call: unknown[]) => call[0] === "terminal-exit")!;
    act(() => {
      exitCall[1]({ code: 0 });
    });
    await userEvent.click(screen.getByText("Reconnect"));
    const connectCalls = pushEvent.mock.calls.filter((call: unknown[]) => call[0] === "connect-terminal");
    expect(connectCalls).toHaveLength(2);
  });
});

describe("LocalEchoPredictor", () => {
  let term: XTerm;
  let predictor: LocalEchoPredictor;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    term = new XTerm();
    predictor = new LocalEchoPredictor(term);
  });

  afterEach(() => {
    predictor.dispose();
    vi.useRealTimers();
  });

  it("writes printable characters in dim style", () => {
    predictor.predict("a");
    expect(mockWrite).toHaveBeenCalledWith("\x1b[2ma\x1b[22m");
    expect(predictor.pendingCount).toBe(1);
  });

  it("does not predict non-printable characters", () => {
    predictor.predict("\r"); // Enter
    expect(mockWrite).not.toHaveBeenCalled();
    expect(predictor.pendingCount).toBe(0);
  });

  it("does not predict multi-char data (escape sequences)", () => {
    predictor.predict("\x1b[A"); // Arrow up
    expect(predictor.pendingCount).toBe(0);
  });

  it("clears predictions when non-printable input arrives", () => {
    predictor.predict("a");
    predictor.predict("b");
    mockWrite.mockClear();

    predictor.predict("\t"); // Tab
    // Should erase 2 dim chars: move back 2 + clear to EOL
    expect(mockWrite).toHaveBeenCalledWith("\x1b[2D\x1b[0K");
    expect(predictor.pendingCount).toBe(0);
  });

  it("confirms predictions on matching server output", () => {
    predictor.predict("a");
    mockWrite.mockClear();

    const output = new TextEncoder().encode("a");
    predictor.handleOutput(output);

    // Should move cursor back over dim char, then write server output
    expect(mockWrite).toHaveBeenCalledWith("\x1b[1D");
    expect(mockWrite).toHaveBeenCalledWith(output);
    expect(predictor.pendingCount).toBe(0);
  });

  it("confirms partial predictions and re-draws remaining", () => {
    predictor.predict("a");
    predictor.predict("b");
    predictor.predict("c");
    mockWrite.mockClear();

    const output = new TextEncoder().encode("a");
    predictor.handleOutput(output);

    // Move back 3 (total dim), write server "a", re-draw "bc" dim
    expect(mockWrite).toHaveBeenCalledWith("\x1b[3D");
    expect(mockWrite).toHaveBeenCalledWith(output);
    expect(mockWrite).toHaveBeenCalledWith("\x1b[2mbc\x1b[22m");
    expect(predictor.pendingCount).toBe(2);
  });

  it("rolls back predictions on mismatched output", () => {
    predictor.predict("a");
    mockWrite.mockClear();

    const output = new TextEncoder().encode("xyz");
    predictor.handleOutput(output);

    // Should clear dim char, then write server output
    expect(mockWrite).toHaveBeenCalledWith("\x1b[1D\x1b[0K");
    expect(mockWrite).toHaveBeenCalledWith(output);
    expect(predictor.pendingCount).toBe(0);
  });

  it("passes output through when no predictions pending", () => {
    const output = new TextEncoder().encode("hello");
    predictor.handleOutput(output);
    expect(mockWrite).toHaveBeenCalledWith(output);
  });

  it("resets predictions after 1 second timeout", () => {
    predictor.predict("a");
    expect(predictor.pendingCount).toBe(1);
    mockWrite.mockClear();

    vi.advanceTimersByTime(1000);

    // Should have cleared the dim prediction
    expect(mockWrite).toHaveBeenCalledWith("\x1b[1D\x1b[0K");
    expect(predictor.pendingCount).toBe(0);
  });

  it("resets timeout when new prediction arrives", () => {
    predictor.predict("a");
    vi.advanceTimersByTime(800);
    predictor.predict("b");
    mockWrite.mockClear();

    // 800ms after second char — should NOT have reset yet
    vi.advanceTimersByTime(800);
    expect(predictor.pendingCount).toBe(2);

    // 200ms more — now 1000ms after second char, should reset
    vi.advanceTimersByTime(200);
    expect(predictor.pendingCount).toBe(0);
  });
});
