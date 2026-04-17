import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { ThemeProvider } from "../components/ThemeProvider";

let matchMediaListeners: Array<(e: { matches: boolean }) => void> = [];
let matchMediaMatches = false;
let originalMatchMedia: typeof globalThis.matchMedia;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  matchMediaListeners = [];
  matchMediaMatches = false;

  originalMatchMedia = globalThis.matchMedia;
  globalThis.matchMedia = mock((query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" ? matchMediaMatches : false,
    media: query,
    onchange: null,
    addListener: mock(() => {}),
    removeListener: mock(() => {}),
    dispatchEvent: mock(() => true),
    addEventListener: (_event: string, handler: (e: { matches: boolean }) => void) => {
      matchMediaListeners.push(handler);
    },
    removeEventListener: (_event: string, handler: (e: { matches: boolean }) => void) => {
      matchMediaListeners = matchMediaListeners.filter((h) => h !== handler);
    },
  })) as unknown as typeof globalThis.matchMedia;
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
  globalThis.matchMedia = originalMatchMedia;
});

describe("ThemeProvider", () => {
  it("renders children", () => {
    const { container } = render(
      <ThemeProvider>
        <span>hello</span>
      </ThemeProvider>,
    );
    expect(container.textContent).toBe("hello");
  });

  it("syncs .dark class on mount when system prefers dark", () => {
    matchMediaMatches = true;
    render(
      <ThemeProvider>
        <span>test</span>
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("does not add .dark on mount when system prefers light", () => {
    matchMediaMatches = false;
    render(
      <ThemeProvider>
        <span>test</span>
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("responds to system preference changes when theme is system", () => {
    render(
      <ThemeProvider>
        <span>test</span>
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => {
      matchMediaListeners.forEach((fn) => fn({ matches: true }));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("ignores system preference changes when theme is explicitly set", () => {
    localStorage.setItem("theme", "light");
    render(
      <ThemeProvider>
        <span>test</span>
      </ThemeProvider>,
    );

    act(() => {
      matchMediaListeners.forEach((fn) => fn({ matches: true }));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("cleans up listener on unmount", () => {
    const { unmount } = render(
      <ThemeProvider>
        <span>test</span>
      </ThemeProvider>,
    );
    expect(matchMediaListeners.length).toBe(1);
    unmount();
    expect(matchMediaListeners.length).toBe(0);
  });
});
