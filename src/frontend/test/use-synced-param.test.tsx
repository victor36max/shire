import { act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "bun:test";
import { useSyncedParam } from "../hooks/use-synced-param";
import { renderHookWithProviders } from "./test-utils";

beforeEach(() => {
  localStorage.clear();
});

describe("useSyncedParam", () => {
  it("reads value from URL search param", () => {
    const { result } = renderHookWithProviders(() => useSyncedParam("file", "shire:file:test"), {
      route: "/test?file=%2Fdocs%2Freadme.md",
      routePath: "/test",
    });
    expect(result.current[0]).toBe("/docs/readme.md");
  });

  it("falls back to localStorage when URL param is absent", () => {
    localStorage.setItem("shire:file:test", "/docs/readme.md");
    const { result } = renderHookWithProviders(() => useSyncedParam("file", "shire:file:test"), {
      route: "/test",
      routePath: "/test",
    });
    expect(result.current[0]).toBe("/docs/readme.md");
  });

  it("returns null when neither URL nor localStorage has a value", () => {
    const { result } = renderHookWithProviders(() => useSyncedParam("file", "shire:file:test"), {
      route: "/test",
      routePath: "/test",
    });
    expect(result.current[0]).toBeNull();
  });

  it("URL param takes precedence over localStorage", () => {
    localStorage.setItem("shire:file:test", "/old-file.md");
    const { result } = renderHookWithProviders(() => useSyncedParam("file", "shire:file:test"), {
      route: "/test?file=%2Fnew-file.md",
      routePath: "/test",
    });
    expect(result.current[0]).toBe("/new-file.md");
  });

  it("syncs URL param to localStorage", () => {
    renderHookWithProviders(() => useSyncedParam("file", "shire:file:test"), {
      route: "/test?file=%2Fdocs%2Freadme.md",
      routePath: "/test",
    });
    expect(localStorage.getItem("shire:file:test")).toBe("/docs/readme.md");
  });

  it("setValue updates both URL and localStorage", () => {
    const { result } = renderHookWithProviders(() => useSyncedParam("file", "shire:file:test"), {
      route: "/test",
      routePath: "/test",
    });

    act(() => {
      result.current[1]("/new-path.md");
    });

    expect(result.current[0]).toBe("/new-path.md");
    expect(localStorage.getItem("shire:file:test")).toBe("/new-path.md");
  });

  it("setValue(null) clears both URL and localStorage", () => {
    localStorage.setItem("shire:file:test", "/old.md");
    const { result } = renderHookWithProviders(() => useSyncedParam("file", "shire:file:test"), {
      route: "/test?file=%2Fold.md",
      routePath: "/test",
    });

    act(() => {
      result.current[1](null);
    });

    expect(result.current[0]).toBeNull();
    expect(localStorage.getItem("shire:file:test")).toBeNull();
  });

  it("returns null from localStorage when disabled", () => {
    localStorage.setItem("shire:file:test", "/saved.md");
    const { result } = renderHookWithProviders(
      () => useSyncedParam("file", "shire:file:test", { disabled: true }),
      { route: "/test", routePath: "/test" },
    );
    expect(result.current[0]).toBeNull();
  });

  it("still reads URL param when disabled", () => {
    const { result } = renderHookWithProviders(
      () => useSyncedParam("file", "shire:file:test", { disabled: true }),
      { route: "/test?file=%2Fdocs%2Freadme.md", routePath: "/test" },
    );
    expect(result.current[0]).toBe("/docs/readme.md");
  });
});
