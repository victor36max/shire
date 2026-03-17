import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import Terminal from "../react-components/Terminal";

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
    onDataCallback("hello");
    expect(pushEvent).toHaveBeenCalledWith("terminal-input", { data: "hello" });
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
