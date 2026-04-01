import { afterEach, beforeAll, afterAll, expect } from "bun:test";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { mock } from "bun:test";
import { server } from "./msw-server";

declare global {
  interface Window {
    happyDOM?: { setURL(url: string): void };
  }
}

expect.extend(matchers);

// Set location for Hono RPC client URL construction
if (window.location.href === "about:blank") {
  window.happyDOM?.setURL("http://localhost");
}

// Start MSW server for all tests
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

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
