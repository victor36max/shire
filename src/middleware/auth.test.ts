import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { SignJWT } from "jose";
import { authMiddleware } from "./auth";
import type { AppEnv } from "../types";
import { getJwtSecret, resetCachedSecret } from "../lib/auth-config";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function createTestApp() {
  const app = new Hono<AppEnv>()
    .use("*", authMiddleware())
    .get("/api/health", (c) => c.json({ status: "ok" }))
    .get("/api/config", (c) => c.json({ authEnabled: true }))
    .post("/api/auth/login", (c) => c.json({ ok: true }))
    .post("/api/auth/refresh", (c) => c.json({ ok: true }))
    .post("/api/auth/logout", (c) => c.json({ ok: true }))
    .get("/api/projects", (c) => c.json({ projects: [], username: c.get("username") }));
  return app;
}

async function makeAccessToken(secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ sub: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("15m")
    .sign(key);
}

describe("authMiddleware", () => {
  const origEnv = { ...process.env };
  let tmpDir: string;

  beforeEach(() => {
    resetCachedSecret();
    tmpDir = mkdtempSync(join(tmpdir(), "shire-test-"));
    process.env.SHIRE_DATA_DIR = tmpDir;
    process.env.SHIRE_USERNAME = "admin";
    process.env.SHIRE_PASSWORD = "secret";
  });

  afterEach(() => {
    process.env = { ...origEnv };
    rmSync(tmpDir, { recursive: true });
  });

  describe("auth disabled", () => {
    test("passes through all routes when SHIRE_USERNAME is not set", async () => {
      delete process.env.SHIRE_USERNAME;
      const app = createTestApp();
      const res = await app.request("/api/projects");
      expect(res.status).toBe(200);
    });

    test("sets username to null when auth is disabled", async () => {
      delete process.env.SHIRE_USERNAME;
      const app = createTestApp();
      const res = await app.request("/api/projects");
      const body = (await res.json()) as { username: unknown };
      expect(body.username).toBeNull();
    });
  });

  describe("auth enabled", () => {
    test("allows public paths without token", async () => {
      const app = createTestApp();
      const paths = [
        { method: "GET", path: "/api/health" },
        { method: "GET", path: "/api/config" },
        { method: "POST", path: "/api/auth/login" },
        { method: "POST", path: "/api/auth/refresh" },
        { method: "POST", path: "/api/auth/logout" },
      ];
      for (const { method, path } of paths) {
        const res = await app.request(path, { method });
        expect(res.status).toBe(200);
      }
    });

    test("returns 401 for protected routes without token", async () => {
      const app = createTestApp();
      const res = await app.request("/api/projects");
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Unauthorized");
    });

    test("returns 401 for invalid token", async () => {
      const app = createTestApp();
      const res = await app.request("/api/projects", {
        headers: { Authorization: "Bearer invalid-token" },
      });
      expect(res.status).toBe(401);
    });

    test("returns 401 for token signed with wrong secret", async () => {
      const app = createTestApp();
      const token = await makeAccessToken("wrong-secret");
      const res = await app.request("/api/projects", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
    });

    test("passes through with valid token and sets username from JWT", async () => {
      const app = createTestApp();
      const token = await makeAccessToken(getJwtSecret());
      const res = await app.request("/api/projects", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { username: unknown };
      expect(body.username).toBe("admin");
    });

    test("returns 401 for expired token", async () => {
      const app = createTestApp();
      const key = new TextEncoder().encode(getJwtSecret());
      const token = await new SignJWT({ sub: "admin" })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("-1s")
        .sign(key);
      const res = await app.request("/api/projects", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
    });
  });
});
