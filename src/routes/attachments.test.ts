import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { createTestDb } from "../test/setup";
import { createApp } from "../server";
import { ProjectManager } from "../runtime/project-manager";
import { Scheduler } from "../runtime/scheduler";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as workspace from "../services/workspace";

let app: ReturnType<typeof createApp>;
let testDir: string;
let projectId: string;
let agentId: string;

beforeEach(async () => {
  createTestDb();
  testDir = join(
    tmpdir(),
    `attachments_route_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  );
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

  const createRes = await request("POST", "/api/projects", { name: "test-project" });
  const projectData = (await createRes.json()) as Record<string, string>;
  projectId = projectData.id;

  const agentRes = await request("POST", `/api/projects/${projectId}/agents`, {
    name: "test-agent",
    description: "Test",
  });
  const agentData = (await agentRes.json()) as Record<string, string>;
  agentId = agentData.id;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

async function request(method: string, path: string, body?: unknown) {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return app.request(path, opts);
}

function createAttachment(attId: string, filename: string, content: Buffer) {
  const dir = workspace.attachmentDir(projectId, agentId, attId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content);
}

describe("GET /api/projects/:id/agents/:aid/attachments/:attId/:filename", () => {
  it("returns correct Content-Type for PNG images", async () => {
    createAttachment("att-1", "photo.png", Buffer.from("fake-png"));

    const res = await request(
      "GET",
      `/api/projects/${projectId}/agents/${agentId}/attachments/att-1/photo.png`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="photo.png"');
  });

  it("returns correct Content-Type for JPEG images", async () => {
    createAttachment("att-2", "photo.jpg", Buffer.from("fake-jpg"));

    const res = await request(
      "GET",
      `/api/projects/${projectId}/agents/${agentId}/attachments/att-2/photo.jpg`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="photo.jpg"');
  });

  it("returns Content-Disposition: attachment for non-image files", async () => {
    createAttachment("att-3", "data.csv", Buffer.from("a,b,c"));

    const res = await request(
      "GET",
      `/api/projects/${projectId}/agents/${agentId}/attachments/att-3/data.csv`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="data.csv"');
  });

  it("returns application/octet-stream for unknown extensions", async () => {
    createAttachment("att-4", "file.xyz", Buffer.from("unknown"));

    const res = await request(
      "GET",
      `/api/projects/${projectId}/agents/${agentId}/attachments/att-4/file.xyz`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="file.xyz"');
  });

  it("returns 404 for missing attachment", async () => {
    const res = await request(
      "GET",
      `/api/projects/${projectId}/agents/${agentId}/attachments/missing/file.png`,
    );
    expect(res.status).toBe(404);
  });

  it("rejects path traversal in filename", async () => {
    createAttachment("att-safe", "ok.txt", Buffer.from("safe"));

    const res = await request(
      "GET",
      `/api/projects/${projectId}/agents/${agentId}/attachments/att-safe/..%2F..%2Fetc%2Fpasswd`,
    );
    expect(res.status).toBe(400);
  });

  it("serves SVG as attachment, not inline, to prevent XSS", async () => {
    createAttachment("att-svg", "icon.svg", Buffer.from("<svg></svg>"));

    const res = await request(
      "GET",
      `/api/projects/${projectId}/agents/${agentId}/attachments/att-svg/icon.svg`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="icon.svg"');
  });

  it("rejects path traversal in agentId", async () => {
    const res = await request(
      "GET",
      `/api/projects/${projectId}/agents/..%2F..%2Fetc/attachments/att-1/file.txt`,
    );
    expect(res.status).toBe(400);
  });

  it("resolves project by name", async () => {
    createAttachment("att-5", "image.gif", Buffer.from("fake-gif"));

    const res = await request(
      "GET",
      `/api/projects/test-project/agents/${agentId}/attachments/att-5/image.gif`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/gif");
  });
});

function multipartUpload(path: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return app.request(path, { method: "POST", body: formData });
}

describe("POST /api/projects/:id/agents/:aid/attachments", () => {
  it("uploads a file and returns metadata", async () => {
    const file = new File(["hello world"], "test.txt", { type: "text/plain" });
    const res = await multipartUpload(
      `/api/projects/${projectId}/agents/${agentId}/attachments`,
      file,
    );

    expect(res.status).toBe(201);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.filename).toBe("test.txt");
    expect(data.content_type).toBe("text/plain");
    expect(data.size).toBe(11);
    expect(typeof data.id).toBe("string");

    // Verify file written to disk
    const attDir = workspace.attachmentDir(projectId, agentId, data.id as string);
    expect(existsSync(join(attDir, "test.txt"))).toBe(true);
    expect(readFileSync(join(attDir, "test.txt"), "utf-8")).toBe("hello world");
  });

  it("rejects request without file field", async () => {
    const res = await app.request(`/api/projects/${projectId}/agents/${agentId}/attachments`, {
      method: "POST",
      body: new FormData(),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBe("Missing file field");
  });

  it("rejects filename with path traversal", async () => {
    const file = new File(["bad"], "../../etc/passwd", { type: "text/plain" });
    const res = await multipartUpload(
      `/api/projects/${projectId}/agents/${agentId}/attachments`,
      file,
    );
    expect(res.status).toBe(400);
  });

  it("rejects path traversal in projectId", async () => {
    const file = new File(["x"], "ok.txt", { type: "text/plain" });
    const res = await multipartUpload(
      `/api/projects/..%2F..%2Fetc/agents/${agentId}/attachments`,
      file,
    );
    expect(res.status).toBe(400);
  });

  it("rejects path traversal in agentId", async () => {
    const file = new File(["x"], "ok.txt", { type: "text/plain" });
    const res = await multipartUpload(
      `/api/projects/${projectId}/agents/..%2F..%2Fetc/attachments`,
      file,
    );
    expect(res.status).toBe(400);
  });

  it("resolves project by name", async () => {
    const file = new File(["data"], "doc.pdf", { type: "application/pdf" });
    const res = await multipartUpload(
      `/api/projects/test-project/agents/${agentId}/attachments`,
      file,
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.filename).toBe("doc.pdf");
  });

  it("creates unique attachment IDs for separate uploads", async () => {
    const file1 = new File(["a"], "a.txt", { type: "text/plain" });
    const file2 = new File(["b"], "b.txt", { type: "text/plain" });

    const res1 = await multipartUpload(
      `/api/projects/${projectId}/agents/${agentId}/attachments`,
      file1,
    );
    const res2 = await multipartUpload(
      `/api/projects/${projectId}/agents/${agentId}/attachments`,
      file2,
    );

    const data1 = (await res1.json()) as Record<string, unknown>;
    const data2 = (await res2.json()) as Record<string, unknown>;
    expect(data1.id).not.toBe(data2.id);

    // Both files exist on disk
    const attDir = workspace.attachmentsDir(projectId, agentId);
    const entries = readdirSync(attDir).filter((e) => e !== "outbox");
    expect(entries.length).toBe(2);
  });
});
