import { afterEach, expect } from "bun:test";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { mock } from "bun:test";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

// Mock scrollIntoView for happy-dom
Element.prototype.scrollIntoView = () => {};

// Mock ResizeObserver for happy-dom
class MockResizeObserver {
  observe = mock(() => {});
  unobserve = mock(() => {});
  disconnect = mock(() => {});
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// Mock matchMedia for happy-dom (ThemeProvider uses it)
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: mock((query: string) => ({
    matches: false,
    media: query,
    addEventListener: mock(() => {}),
    removeEventListener: mock(() => {}),
  })),
});
