import { describe, it, expect } from "bun:test";
import { safePath } from "./shared-drive";

describe("safePath", () => {
  const root = "/home/user/.shire/projects/p1/shared";

  it("resolves root path for empty string", () => {
    expect(safePath(root, "")).toBe(root);
  });

  it("resolves root path for /", () => {
    expect(safePath(root, "/")).toBe(root);
  });

  it("resolves a simple filename", () => {
    expect(safePath(root, "file.txt")).toBe(`${root}/file.txt`);
  });

  it("resolves a nested path", () => {
    expect(safePath(root, "sub/dir/file.txt")).toBe(`${root}/sub/dir/file.txt`);
  });

  it("resolves leading slash", () => {
    expect(safePath(root, "/file.txt")).toBe(`${root}/file.txt`);
  });

  it("blocks ../ path traversal", () => {
    expect(safePath(root, "../../../etc/passwd")).toBeNull();
  });

  it("blocks ../ traversal with leading slash", () => {
    expect(safePath(root, "/../../../etc/passwd")).toBeNull();
  });

  it("blocks mid-path traversal", () => {
    expect(safePath(root, "sub/../../outside")).toBeNull();
  });

  it("allows paths that contain .. in filenames", () => {
    // "foo..bar" is a valid filename, not traversal
    const result = safePath(root, "foo..bar");
    expect(result).toBe(`${root}/foo..bar`);
  });

  it("blocks traversal that resolves just outside root", () => {
    expect(safePath(root, "sub/../..")).toBeNull();
  });

  it("allows paths that resolve within root via ..", () => {
    expect(safePath(root, "sub/../file.txt")).toBe(`${root}/file.txt`);
  });

  it("blocks prefix-collision paths (e.g. /shared vs /shared-evil)", () => {
    // A sibling directory that starts with the same prefix should be rejected
    expect(safePath(root, "../shared-evil/secret")).toBeNull();
  });

  it("resolves double-slash paths (e.g. //docs from frontend)", () => {
    expect(safePath(root, "//docs")).toBe(`${root}/docs`);
  });

  it("resolves triple-slash paths", () => {
    expect(safePath(root, "///file.txt")).toBe(`${root}/file.txt`);
  });
});
