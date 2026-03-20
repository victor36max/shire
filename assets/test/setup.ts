import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = () => {};

// Mock ResizeObserver for jsdom
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// Mock useLiveReact globally — individual tests can override via vi.mocked()
vi.mock("live_react", () => ({
  useLiveReact: vi.fn(() => ({
    handleEvent: vi.fn().mockReturnValue("ref-id"),
    removeHandleEvent: vi.fn(),
    pushEvent: vi.fn(),
    pushEventTo: vi.fn(),
    upload: vi.fn(),
    uploadTo: vi.fn(),
  })),
}));
