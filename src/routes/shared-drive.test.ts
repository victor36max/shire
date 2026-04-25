import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { safePath } from "./shared-drive";
import { createTestDb } from "../test/setup";
import { createApp } from "../server";
import { ProjectManager } from "../runtime/project-manager";
import { Scheduler } from "../runtime/scheduler";
import * as workspace from "../services/workspace";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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

describe("shared-drive routes", () => {
  let app: ReturnType<typeof createApp>;
  let testDir: string;
  let projectId: string;

  beforeEach(async () => {
    createTestDb();
    testDir = join(tmpdir(), `sd_route_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    process.env.SHIRE_PROJECTS_DIR = testDir;

    mock.module("../runtime/harness", () => ({
      createHarness: () => ({
        start: async () => {},
        sendMessage: async () => {},
        interrupt: async () => {},
        clearSession: async () => {},
        stop: async () => {},
        onEvent: () => {},
        isProcessing: () => false,
        getSessionId: () => null,
      }),
    }));

    const projectManager = new ProjectManager();
    const scheduler = new Scheduler(projectManager);
    app = createApp({ projectManager, scheduler });

    const createRes = await request("POST", "/api/projects", { name: "sd-test" });
    const data = (await createRes.json()) as Record<string, string>;
    projectId = data.id;
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function request(method: string, path: string, body?: unknown) {
    const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    return app.request(path, opts);
  }

  it("GET /api/projects/:id/shared-drive returns empty files for new project", async () => {
    const res = await request("GET", `/api/projects/${projectId}/shared-drive`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { files: unknown[]; currentPath: string };
    expect(data.files).toEqual([]);
    expect(data.currentPath).toBe("/");
  });

  it("GET /api/projects/:id/shared-drive returns 404 for unknown project", async () => {
    const res = await request("GET", "/api/projects/nonexistent/shared-drive");
    expect(res.status).toBe(404);
  });

  it("GET /api/projects/:id/shared-drive returns 400 for traversal path", async () => {
    const res = await request("GET", `/api/projects/${projectId}/shared-drive?path=../../etc`);
    expect(res.status).toBe(400);
  });

  it("GET /api/projects/:id/shared-drive lists created files", async () => {
    const sharedRoot = workspace.sharedDir(projectId);
    mkdirSync(sharedRoot, { recursive: true });
    writeFileSync(join(sharedRoot, "test.txt"), "hello");

    const res = await request("GET", `/api/projects/${projectId}/shared-drive`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { files: Array<{ name: string; type: string }> };
    expect(data.files.length).toBe(1);
    expect(data.files[0].name).toBe("test.txt");
    expect(data.files[0].type).toBe("file");
  });

  it("GET /api/projects/:id/shared-drive/search finds files recursively", async () => {
    const sharedRoot = workspace.sharedDir(projectId);
    mkdirSync(join(sharedRoot, "docs"), { recursive: true });
    writeFileSync(join(sharedRoot, "readme.md"), "hello");
    writeFileSync(join(sharedRoot, "docs", "guide.md"), "guide");
    writeFileSync(join(sharedRoot, "docs", "test.txt"), "test");

    const res = await request("GET", `/api/projects/${projectId}/shared-drive/search?q=guide`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { files: Array<{ name: string; path: string }> };
    expect(data.files.length).toBe(1);
    expect(data.files[0].name).toBe("guide.md");
    expect(data.files[0].path).toBe("/docs/guide.md");
  });

  it("GET /api/projects/:id/shared-drive/search returns files from all levels", async () => {
    const sharedRoot = workspace.sharedDir(projectId);
    mkdirSync(join(sharedRoot, "sub"), { recursive: true });
    writeFileSync(join(sharedRoot, "test.md"), "root");
    writeFileSync(join(sharedRoot, "sub", "test.txt"), "nested");

    const res = await request("GET", `/api/projects/${projectId}/shared-drive/search?q=test`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { files: Array<{ name: string; path: string }> };
    expect(data.files.length).toBe(2);
    const names = data.files.map((f) => f.name);
    expect(names).toContain("test.md");
    expect(names).toContain("test.txt");
  });

  it("GET /api/projects/:id/shared-drive/search returns 404 for unknown project", async () => {
    const res = await request("GET", "/api/projects/nonexistent/shared-drive/search?q=test");
    expect(res.status).toBe(404);
  });

  it("GET /api/projects/:id/shared-drive/preview returns file content", async () => {
    const sharedRoot = workspace.sharedDir(projectId);
    mkdirSync(sharedRoot, { recursive: true });
    writeFileSync(join(sharedRoot, "readme.txt"), "file content");

    const res = await request(
      "GET",
      `/api/projects/${projectId}/shared-drive/preview?path=readme.txt`,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { content: string; filename: string; size: number };
    expect(data.content).toBe("file content");
    expect(data.filename).toBe("readme.txt");
  });

  it("GET /api/projects/:id/shared-drive/preview returns 404 for missing file", async () => {
    const res = await request(
      "GET",
      `/api/projects/${projectId}/shared-drive/preview?path=missing.txt`,
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/projects/:id/shared-drive/preview returns 413 for large files", async () => {
    const sharedRoot = workspace.sharedDir(projectId);
    mkdirSync(sharedRoot, { recursive: true });
    // Create a file > 1MB
    writeFileSync(join(sharedRoot, "big.bin"), Buffer.alloc(1024 * 1024 + 1));

    const res = await request(
      "GET",
      `/api/projects/${projectId}/shared-drive/preview?path=big.bin`,
    );
    expect(res.status).toBe(413);
  });

  it("GET /api/projects/:id/shared-drive/preview returns 404 for unknown project", async () => {
    const res = await request(
      "GET",
      "/api/projects/nonexistent/shared-drive/preview?path=test.txt",
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/projects/:id/shared-drive/preview returns 400 for traversal", async () => {
    const res = await request(
      "GET",
      `/api/projects/${projectId}/shared-drive/preview?path=../../etc/passwd`,
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/projects/:id/shared-drive/download returns file as attachment", async () => {
    const sharedRoot = workspace.sharedDir(projectId);
    mkdirSync(sharedRoot, { recursive: true });
    writeFileSync(join(sharedRoot, "dl.txt"), "download me");

    const res = await request(
      "GET",
      `/api/projects/${projectId}/shared-drive/download?path=dl.txt`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("dl.txt");
    expect(res.headers.get("Content-Type")).toBe("text/plain");
  });

  it("GET /api/projects/:id/shared-drive/download returns correct Content-Type for images", async () => {
    const sharedRoot = workspace.sharedDir(projectId);
    mkdirSync(sharedRoot, { recursive: true });
    // Write a minimal PNG header
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(join(sharedRoot, "photo.png"), pngHeader);

    const res = await request(
      "GET",
      `/api/projects/${projectId}/shared-drive/download?path=photo.png`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toContain("inline");
  });

  it("GET /api/projects/:id/shared-drive/download returns 404 for missing file", async () => {
    const res = await request(
      "GET",
      `/api/projects/${projectId}/shared-drive/download?path=missing.txt`,
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/projects/:id/shared-drive/download returns 404 for unknown project", async () => {
    const res = await request("GET", "/api/projects/nonexistent/shared-drive/download?path=x.txt");
    expect(res.status).toBe(404);
  });

  it("GET /api/projects/:id/shared-drive/download returns 400 for traversal", async () => {
    const res = await request(
      "GET",
      `/api/projects/${projectId}/shared-drive/download?path=../../etc/passwd`,
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/projects/:id/shared-drive/directory creates a directory", async () => {
    const res = await app.request(`/api/projects/${projectId}/shared-drive/directory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new-dir" }),
    });
    expect(res.status).toBe(201);

    // Verify directory appears in listing
    const listRes = await request("GET", `/api/projects/${projectId}/shared-drive`);
    const data = (await listRes.json()) as { files: Array<{ name: string; type: string }> };
    expect(data.files.some((f) => f.name === "new-dir" && f.type === "directory")).toBe(true);
  });

  it("POST /api/projects/:id/shared-drive/directory returns 404 for unknown project", async () => {
    const res = await app.request("/api/projects/nonexistent/shared-drive/directory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dir" }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /api/projects/:id/shared-drive/directory returns 400 for traversal", async () => {
    const res = await app.request(`/api/projects/${projectId}/shared-drive/directory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "evil", path: "../../../tmp" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/projects/:id/shared-drive/upload uploads a file", async () => {
    const formData = new FormData();
    formData.append("file", new File(["test content"], "upload.txt", { type: "text/plain" }));

    const res = await app.request(`/api/projects/${projectId}/shared-drive/upload`, {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(201);

    // Verify file appears in listing
    const listRes = await request("GET", `/api/projects/${projectId}/shared-drive`);
    const data = (await listRes.json()) as { files: Array<{ name: string }> };
    expect(data.files.some((f) => f.name === "upload.txt")).toBe(true);
  });

  it("POST /api/projects/:id/shared-drive/upload returns 400 for missing file", async () => {
    const formData = new FormData();
    formData.append("notfile", "text");

    const res = await app.request(`/api/projects/${projectId}/shared-drive/upload`, {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/projects/:id/shared-drive/upload returns 400 for invalid filename", async () => {
    const formData = new FormData();
    formData.append("file", new File(["x"], "../evil.txt", { type: "text/plain" }));

    const res = await app.request(`/api/projects/${projectId}/shared-drive/upload`, {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/projects/:id/shared-drive/upload returns 404 for unknown project", async () => {
    const formData = new FormData();
    formData.append("file", new File(["x"], "test.txt", { type: "text/plain" }));

    const res = await app.request("/api/projects/nonexistent/shared-drive/upload", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/projects/:id/shared-drive deletes a file", async () => {
    const sharedRoot = workspace.sharedDir(projectId);
    mkdirSync(sharedRoot, { recursive: true });
    writeFileSync(join(sharedRoot, "delete-me.txt"), "bye");

    const res = await app.request(`/api/projects/${projectId}/shared-drive?path=delete-me.txt`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    // Verify file is gone
    const listRes = await request("GET", `/api/projects/${projectId}/shared-drive`);
    const data = (await listRes.json()) as { files: Array<{ name: string }> };
    expect(data.files.some((f) => f.name === "delete-me.txt")).toBe(false);
  });

  it("DELETE /api/projects/:id/shared-drive deletes a directory", async () => {
    const sharedRoot = workspace.sharedDir(projectId);
    mkdirSync(join(sharedRoot, "del-dir"), { recursive: true });

    const res = await app.request(`/api/projects/${projectId}/shared-drive?path=del-dir`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
  });

  it("DELETE /api/projects/:id/shared-drive returns 404 for missing path", async () => {
    const res = await app.request(`/api/projects/${projectId}/shared-drive?path=nope.txt`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/projects/:id/shared-drive returns 404 for unknown project", async () => {
    const res = await app.request("/api/projects/nonexistent/shared-drive?path=x.txt", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/projects/:id/shared-drive returns 400 for traversal", async () => {
    const res = await app.request(`/api/projects/${projectId}/shared-drive?path=../../etc`, {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
  });

  it("PUT /api/projects/:id/shared-drive/content saves file content", async () => {
    const sharedRoot = workspace.sharedDir(projectId);
    mkdirSync(sharedRoot, { recursive: true });
    writeFileSync(join(sharedRoot, "doc.md"), "old content");

    const res = await request("PUT", `/api/projects/${projectId}/shared-drive/content`, {
      path: "doc.md",
      content: "# Updated\n\nNew content here.",
    });
    expect(res.status).toBe(200);

    // Verify content was written
    const previewRes = await request(
      "GET",
      `/api/projects/${projectId}/shared-drive/preview?path=doc.md`,
    );
    const data = (await previewRes.json()) as { content: string };
    expect(data.content).toBe("# Updated\n\nNew content here.");
  });

  it("PUT /api/projects/:id/shared-drive/content returns 404 for unknown project", async () => {
    const res = await request("PUT", "/api/projects/nonexistent/shared-drive/content", {
      path: "doc.md",
      content: "test",
    });
    expect(res.status).toBe(404);
  });

  it("PUT /api/projects/:id/shared-drive/content returns 400 for traversal", async () => {
    const res = await request("PUT", `/api/projects/${projectId}/shared-drive/content`, {
      path: "../../etc/passwd",
      content: "evil",
    });
    expect(res.status).toBe(400);
  });

  it("PUT /api/projects/:id/shared-drive/content returns 413 for large content", async () => {
    const sharedRoot = workspace.sharedDir(projectId);
    mkdirSync(sharedRoot, { recursive: true });
    writeFileSync(join(sharedRoot, "big.md"), "");

    const res = await request("PUT", `/api/projects/${projectId}/shared-drive/content`, {
      path: "big.md",
      content: "x".repeat(1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
  });

  it("PUT /api/projects/:id/shared-drive/content returns 404 for non-existent file", async () => {
    const sharedRoot = workspace.sharedDir(projectId);
    mkdirSync(sharedRoot, { recursive: true });

    const res = await request("PUT", `/api/projects/${projectId}/shared-drive/content`, {
      path: "does-not-exist.md",
      content: "should fail",
    });
    expect(res.status).toBe(404);
  });

  it("POST /api/projects/:id/shared-drive/file creates a markdown file", async () => {
    const res = await request("POST", `/api/projects/${projectId}/shared-drive/file`, {
      name: "notes",
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { ok: boolean; path: string };
    expect(data.ok).toBe(true);
    expect(data.path).toBe("/notes.md");

    // Verify file appears in listing
    const listRes = await request("GET", `/api/projects/${projectId}/shared-drive`);
    const list = (await listRes.json()) as { files: Array<{ name: string; type: string }> };
    expect(list.files.some((f) => f.name === "notes.md" && f.type === "file")).toBe(true);
  });

  it("POST /api/projects/:id/shared-drive/file auto-appends .md extension", async () => {
    const res = await request("POST", `/api/projects/${projectId}/shared-drive/file`, {
      name: "readme",
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { ok: boolean; path: string };
    expect(data.path).toBe("/readme.md");
  });

  it("POST /api/projects/:id/shared-drive/file preserves .md if already present", async () => {
    const res = await request("POST", `/api/projects/${projectId}/shared-drive/file`, {
      name: "readme.md",
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { ok: boolean; path: string };
    expect(data.path).toBe("/readme.md");
  });

  it("POST /api/projects/:id/shared-drive/file creates in subdirectory", async () => {
    // Create subdirectory first
    await request("POST", `/api/projects/${projectId}/shared-drive/directory`, {
      name: "docs",
    });
    const res = await request("POST", `/api/projects/${projectId}/shared-drive/file`, {
      name: "guide",
      path: "/docs",
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { ok: boolean; path: string };
    expect(data.path).toBe("/docs/guide.md");
  });

  it("POST /api/projects/:id/shared-drive/file returns 409 if file already exists", async () => {
    await request("POST", `/api/projects/${projectId}/shared-drive/file`, { name: "dup" });
    const res = await request("POST", `/api/projects/${projectId}/shared-drive/file`, {
      name: "dup",
    });
    expect(res.status).toBe(409);
  });

  it("POST /api/projects/:id/shared-drive/file returns 400 for traversal", async () => {
    const res = await request("POST", `/api/projects/${projectId}/shared-drive/file`, {
      name: "evil",
      path: "../../../tmp",
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/projects/:id/shared-drive/file returns 400 for empty name", async () => {
    const res = await request("POST", `/api/projects/${projectId}/shared-drive/file`, {
      name: "",
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/projects/:id/shared-drive/file returns 400 for name with slashes", async () => {
    const res = await request("POST", `/api/projects/${projectId}/shared-drive/file`, {
      name: "../../etc/passwd",
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/projects/:id/shared-drive/file returns 404 for unknown project", async () => {
    const res = await request("POST", "/api/projects/nonexistent/shared-drive/file", {
      name: "test",
    });
    expect(res.status).toBe(404);
  });

  it("resolves project by name as well as by id", async () => {
    const res = await request("GET", "/api/projects/sd-test/shared-drive");
    expect(res.status).toBe(200);
  });

  it("GET /api/projects/:id/shared-drive/download-folder returns ZIP for valid directory", async () => {
    const sharedRoot = workspace.sharedDir(projectId);
    const folderPath = join(sharedRoot, "my-folder");
    mkdirSync(folderPath, { recursive: true });
    writeFileSync(join(folderPath, "a.txt"), "file a");
    writeFileSync(join(folderPath, "b.txt"), "file b");

    const res = await request(
      "GET",
      `/api/projects/${projectId}/shared-drive/download-folder?path=/my-folder`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toContain("my-folder.zip");
    // Verify we got a non-empty response
    const data = await res.arrayBuffer();
    expect(data.byteLength).toBeGreaterThan(0);
  });

  it("GET /api/projects/:id/shared-drive/download-folder returns 404 for non-existent path", async () => {
    const res = await request(
      "GET",
      `/api/projects/${projectId}/shared-drive/download-folder?path=/missing-folder`,
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/projects/:id/shared-drive/download-folder returns 400 for traversal", async () => {
    const res = await request(
      "GET",
      `/api/projects/${projectId}/shared-drive/download-folder?path=../../etc`,
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/projects/:id/shared-drive/download-folder returns 400 for file path", async () => {
    const sharedRoot = workspace.sharedDir(projectId);
    mkdirSync(sharedRoot, { recursive: true });
    writeFileSync(join(sharedRoot, "not-a-dir.txt"), "hello");

    const res = await request(
      "GET",
      `/api/projects/${projectId}/shared-drive/download-folder?path=/not-a-dir.txt`,
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/projects/:id/shared-drive/download-folder returns 404 for unknown project", async () => {
    const res = await request(
      "GET",
      "/api/projects/nonexistent/shared-drive/download-folder?path=/dir",
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/projects/:id/shared-drive/download-folder returns Content-Length header", async () => {
    const sharedRoot = workspace.sharedDir(projectId);
    const folderPath = join(sharedRoot, "sized-folder");
    mkdirSync(folderPath, { recursive: true });
    writeFileSync(join(folderPath, "file.txt"), "content");

    const res = await request(
      "GET",
      `/api/projects/${projectId}/shared-drive/download-folder?path=/sized-folder`,
    );
    expect(res.status).toBe(200);
    const contentLength = res.headers.get("Content-Length");
    expect(contentLength).toBeTruthy();
    const data = await res.arrayBuffer();
    expect(data.byteLength.toString()).toBe(contentLength!);
  });

  it("GET /api/projects/:id/shared-drive/download-folder handles nested directories", async () => {
    const sharedRoot = workspace.sharedDir(projectId);
    const folderPath = join(sharedRoot, "parent");
    mkdirSync(join(folderPath, "child"), { recursive: true });
    writeFileSync(join(folderPath, "top.txt"), "top");
    writeFileSync(join(folderPath, "child", "nested.txt"), "nested");

    const res = await request(
      "GET",
      `/api/projects/${projectId}/shared-drive/download-folder?path=/parent`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    const data = await res.arrayBuffer();
    expect(data.byteLength).toBeGreaterThan(0);
  });
});
