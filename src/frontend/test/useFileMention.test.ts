import { describe, it, expect } from "bun:test";
import { act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import { renderHookWithProviders } from "./test-utils";
import { useFileMention } from "../hooks/useFileMention";
import type { SharedDriveFile } from "../hooks/shared-drive";

const sampleFiles: SharedDriveFile[] = [
  { name: "docs", path: "/docs", type: "directory", size: 0 },
  { name: "images", path: "/images", type: "directory", size: 0 },
  { name: "readme.md", path: "/readme.md", type: "file", size: 1024 },
  { name: "notes.txt", path: "/notes.txt", type: "file", size: 512 },
];

function setFiles(files: SharedDriveFile[], path = "/") {
  server.use(
    http.get("*/api/projects/:id/shared-drive", ({ request }) => {
      const url = new URL(request.url);
      const reqPath = url.searchParams.get("path") ?? "/";
      if (reqPath === path) {
        return HttpResponse.json({ files, currentPath: reqPath });
      }
      return HttpResponse.json({ files: [], currentPath: reqPath });
    }),
  );
}

function renderMention(input: string, cursorPosition: number) {
  return renderHookWithProviders(
    ({ input, cursorPosition }) => useFileMention(input, cursorPosition, "p1"),
    {
      initialProps: { input, cursorPosition },
      route: "/projects/test-project",
      routePath: "/projects/:projectName",
    },
  );
}

describe("useFileMention", () => {
  describe("trigger detection", () => {
    it("opens when @ is typed at start of input", () => {
      const { result } = renderMention("@", 1);
      expect(result.current.isOpen).toBe(true);
    });

    it("opens when @ is typed after a space", () => {
      const { result } = renderMention("hello @", 7);
      expect(result.current.isOpen).toBe(true);
    });

    it("does not open when @ is preceded by non-whitespace (email)", () => {
      const { result } = renderMention("user@example.com", 5);
      expect(result.current.isOpen).toBe(false);
    });

    it("does not open when cursor is at position 0", () => {
      const { result } = renderMention("@hello", 0);
      expect(result.current.isOpen).toBe(false);
    });

    it("closes when query contains whitespace", () => {
      const { result } = renderMention("@hello world", 12);
      expect(result.current.isOpen).toBe(false);
    });

    it("does not open with no @ in input", () => {
      const { result } = renderMention("hello world", 11);
      expect(result.current.isOpen).toBe(false);
    });

    it("provides trigger index", () => {
      const { result } = renderMention("check @re", 9);
      expect(result.current.triggerIndex).toBe(6);
    });
  });

  describe("filtering", () => {
    it("filters items by query", async () => {
      setFiles(sampleFiles);
      const { result, rerender } = renderMention("@re", 3);

      // Wait for data to load
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      rerender({ input: "@re", cursorPosition: 3 });

      const names = result.current.items.map((i) => i.name);
      expect(names).toContain("readme.md");
      expect(names).not.toContain("notes.txt");
    });

    it("sorts directories before files", async () => {
      setFiles(sampleFiles);
      const { result } = renderMention("@", 1);

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      const firstFile = result.current.items.findIndex((i) => i.type === "file");
      const lastDir = result.current.items.findLastIndex((i) => i.type === "directory");
      if (firstFile !== -1 && lastDir !== -1) {
        expect(lastDir).toBeLessThan(firstFile);
      }
    });
  });

  describe("navigation", () => {
    it("navigateDown increments selectedIndex", async () => {
      setFiles(sampleFiles);
      const { result } = renderMention("@", 1);

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(result.current.selectedIndex).toBe(0);
      act(() => result.current.navigateDown());
      expect(result.current.selectedIndex).toBe(1);
    });

    it("navigateUp wraps to last item from 0", async () => {
      setFiles(sampleFiles);
      const { result } = renderMention("@", 1);

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(result.current.selectedIndex).toBe(0);
      act(() => result.current.navigateUp());
      expect(result.current.selectedIndex).toBe(result.current.items.length - 1);
    });

    it("navigateDown wraps to 0 from last item", async () => {
      setFiles(sampleFiles);
      const { result } = renderMention("@", 1);

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // Navigate to last
      for (let i = 0; i < result.current.items.length - 1; i++) {
        act(() => result.current.navigateDown());
      }
      expect(result.current.selectedIndex).toBe(result.current.items.length - 1);
      act(() => result.current.navigateDown());
      expect(result.current.selectedIndex).toBe(0);
    });
  });

  describe("selectItem", () => {
    it("returns /shared path for files", async () => {
      setFiles(sampleFiles);
      const { result } = renderMention("@", 1);

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      const fileItem = result.current.items.find((i) => i.type === "file");
      expect(fileItem).toBeDefined();
      const path = result.current.selectItem(fileItem!);
      expect(path).toBe(`/shared${fileItem!.path}`);
    });

    it("returns null for directories and navigates into them", async () => {
      setFiles(sampleFiles);
      const { result } = renderMention("@", 1);

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      const dirItem = result.current.items.find((i) => i.type === "directory");
      expect(dirItem).toBeDefined();
      let path: string | null = null;
      act(() => {
        path = result.current.selectItem(dirItem!);
      });
      expect(path).toBeNull();
      expect(result.current.currentPath).toBe(dirItem!.path);
    });
  });

  describe("dismiss", () => {
    it("closes the dropdown", () => {
      const { result } = renderMention("@", 1);
      expect(result.current.isOpen).toBe(true);

      act(() => result.current.dismiss());
      expect(result.current.isOpen).toBe(false);
    });

    it("re-opens when input changes after dismiss", () => {
      const { result, rerender } = renderMention("@", 1);
      act(() => result.current.dismiss());
      expect(result.current.isOpen).toBe(false);

      rerender({ input: "@r", cursorPosition: 2 });
      expect(result.current.isOpen).toBe(true);
    });
  });

  describe("navigateBack", () => {
    it("navigates to parent directory", async () => {
      setFiles(sampleFiles);
      const { result } = renderMention("@", 1);

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      const dirItem = result.current.items.find((i) => i.type === "directory");
      act(() => {
        result.current.selectItem(dirItem!);
      });
      expect(result.current.currentPath).not.toBe("/");

      act(() => result.current.navigateBack());
      expect(result.current.currentPath).toBe("/");
    });

    it("stays at root when already at root", () => {
      const { result } = renderMention("@", 1);
      act(() => result.current.navigateBack());
      expect(result.current.currentPath).toBe("/");
    });
  });
});
