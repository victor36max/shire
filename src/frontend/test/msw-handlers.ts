import { http, HttpResponse } from "msw";

/**
 * Default MSW handlers for all API endpoints used in frontend tests.
 * Component tests import these as baseline and override per-test with server.use().
 */
export const defaultHandlers = [
  // --- Projects ---
  http.get("*/api/projects", () =>
    HttpResponse.json([{ id: "p1", name: "test-project", status: "running" }]),
  ),
  http.post("*/api/projects", () => HttpResponse.json({ id: "p-new" }, { status: 201 })),
  http.delete("*/api/projects/:id", () => HttpResponse.json({ ok: true })),
  http.post("*/api/projects/:id/restart", () => HttpResponse.json({ ok: true })),
  http.patch("*/api/projects/:id", () => HttpResponse.json({ ok: true })),

  // --- Agents ---
  http.get("*/api/projects/:id/agents", () => HttpResponse.json([])),
  http.post("*/api/projects/:id/agents", () => HttpResponse.json({ id: "a-new" }, { status: 201 })),
  http.get("*/api/projects/:id/agents/:aid", () =>
    HttpResponse.json({
      id: "a1",
      name: "test-agent",
      status: "active",
      harness: "claude_code",
      description: "",
      systemPrompt: "",
      model: "",
      skills: [],
    }),
  ),
  http.patch("*/api/projects/:id/agents/:aid", () => HttpResponse.json({ ok: true })),
  http.delete("*/api/projects/:id/agents/:aid", () => HttpResponse.json({ ok: true })),
  http.post("*/api/projects/:id/agents/:aid/restart", () => HttpResponse.json({ ok: true })),

  // --- Messages ---
  http.get("*/api/projects/:id/agents/:aid/messages", () =>
    HttpResponse.json({ messages: [], hasMore: false }),
  ),
  http.post("*/api/projects/:id/agents/:aid/message", () =>
    HttpResponse.json({ ok: true, message: null }),
  ),
  http.post("*/api/projects/:id/agents/:aid/interrupt", () => HttpResponse.json({ ok: true })),
  http.post("*/api/projects/:id/agents/:aid/mark-read", () => HttpResponse.json({ ok: true })),
  http.post("*/api/projects/:id/agents/:aid/clear", () => HttpResponse.json({ ok: true })),

  // --- Attachments ---
  http.post("*/api/projects/:id/agents/:aid/attachments", () =>
    HttpResponse.json(
      { id: "att-1", filename: "file.txt", content_type: "text/plain", size: 100 },
      { status: 201 },
    ),
  ),

  // --- Activity ---
  http.get("*/api/projects/:id/activity", () =>
    HttpResponse.json({ messages: [], hasMore: false }),
  ),

  // --- Schedules ---
  http.get("*/api/projects/:id/schedules", () => HttpResponse.json([])),
  http.post("*/api/projects/:id/schedules", () =>
    HttpResponse.json({ id: "s-new" }, { status: 201 }),
  ),
  http.patch("*/api/projects/:id/schedules/:sid", () => HttpResponse.json({ ok: true })),
  http.delete("*/api/projects/:id/schedules/:sid", () => HttpResponse.json({ ok: true })),
  http.post("*/api/projects/:id/schedules/:sid/toggle", () => HttpResponse.json({ ok: true })),
  http.post("*/api/projects/:id/schedules/:sid/run", () => HttpResponse.json({ ok: true })),

  // --- Settings ---
  http.get("*/api/projects/:id/settings/project-doc", () =>
    HttpResponse.json({ content: "# Project Doc" }),
  ),
  http.put("*/api/projects/:id/settings/project-doc", () => HttpResponse.json({ ok: true })),

  // --- Shared Drive ---
  http.get("*/api/projects/:id/shared-drive/search", () => HttpResponse.json({ files: [] })),
  http.get("*/api/projects/:id/shared-drive", () =>
    HttpResponse.json({ files: [], currentPath: "/" }),
  ),
  http.post("*/api/projects/:id/shared-drive/directory", () =>
    HttpResponse.json({ ok: true }, { status: 201 }),
  ),
  http.post("*/api/projects/:id/shared-drive/file", () =>
    HttpResponse.json({ ok: true, path: "/test.md" }, { status: 201 }),
  ),
  http.post("*/api/projects/:id/shared-drive/upload", () =>
    HttpResponse.json({ ok: true }, { status: 201 }),
  ),
  http.patch("*/api/projects/:id/shared-drive/rename", () =>
    HttpResponse.json({ ok: true, newPath: "/renamed.md" }),
  ),
  http.delete("*/api/projects/:id/shared-drive", () => HttpResponse.json({ ok: true })),
  http.get("*/api/projects/:id/shared-drive/preview", () =>
    HttpResponse.json({ content: "", contentType: "text/plain" }),
  ),
  http.put("*/api/projects/:id/shared-drive/content", () => HttpResponse.json({ ok: true })),

  // --- Alert Channels ---
  http.get("*/api/projects/:id/alert-channel", () => new HttpResponse(null, { status: 404 })),
  http.put("*/api/projects/:id/alert-channel", () => HttpResponse.json({ ok: true })),
  http.delete("*/api/projects/:id/alert-channel", () => HttpResponse.json({ ok: true })),
  http.post("*/api/projects/:id/alert-channel/test", () => HttpResponse.json({ ok: true })),

  // --- Version ---
  http.get("*/api/version", () =>
    HttpResponse.json({
      current: "0.1.0-dev",
      latest: null,
      updateAvailable: false,
      upgradeCommands: ["npm install -g agents-shire@latest", "bun install -g agents-shire@latest"],
    }),
  ),

  // --- Catalog ---
  http.get("*/api/catalog/agents", () => HttpResponse.json([])),
  http.get("*/api/catalog/categories", () => HttpResponse.json([])),
  http.get("*/api/catalog/agents/:name", () =>
    HttpResponse.json({ name: "test", displayName: "Test", description: "" }),
  ),
];
