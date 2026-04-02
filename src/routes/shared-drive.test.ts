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
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
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

  it("resolves project by name as well as by id", async () => {
    const res = await request("GET", "/api/projects/sd-test/shared-drive");
    expect(res.status).toBe(200);
  });
});
