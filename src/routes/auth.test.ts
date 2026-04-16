import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { SignJWT } from "jose";
import { authRoutes, _loginAttempts } from "./auth";
import { authMiddleware } from "../middleware/auth";
import { getJwtSecret, resetCachedSecret, REFRESH_TOKEN_TTL } from "../lib/auth-config";
import { useTestDb } from "../test/setup";
import { getDb } from "../db";
import { refreshTokens } from "../db/schema";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function createTestApp() {
  return new Hono().use("*", authMiddleware()).route("/api", authRoutes);
}

function createAppWithCookie() {
  return new Hono()
    .use("*", async (c, next) => {
      const testCookie = c.req.header("x-test-cookie");
      if (testCookie) {
        c.req.raw.headers.set("cookie", testCookie);
      }
      await next();
    })
    .route("/api", authRoutes);
}

async function makeAccessToken(): Promise<string> {
  const key = new TextEncoder().encode(getJwtSecret());
  return new SignJWT({ sub: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("15m")
    .sign(key);
}

function insertRefreshToken(token: string, expiresInSeconds = REFRESH_TOKEN_TTL) {
  const db = getDb();
  db.insert(refreshTokens)
    .values({
      token,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    })
    .run();
}

describe("auth routes", () => {
  useTestDb();
  const origEnv = { ...process.env };
  let tmpDir: string;

  beforeEach(() => {
    resetCachedSecret();
    _loginAttempts.clear();
    tmpDir = mkdtempSync(join(tmpdir(), "shire-test-"));
    process.env.SHIRE_DATA_DIR = tmpDir;
    process.env.SHIRE_USERNAME = "admin";
    process.env.SHIRE_PASSWORD = "secret";
  });

  afterEach(() => {
    process.env = { ...origEnv };
    rmSync(tmpDir, { recursive: true });
  });

  describe("POST /api/auth/login", () => {
    test("returns access token and stores refresh token on valid credentials", async () => {
      const app = createTestApp();
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { accessToken: string; username: string };
      expect(body.accessToken).toBeTruthy();
      expect(body.username).toBe("admin");

      const db = getDb();
      const tokens = db.select().from(refreshTokens).all();
      expect(tokens).toHaveLength(1);
      expect(tokens[0].expiresAt).toBeTruthy();
    });

    test("returns 401 on wrong password", async () => {
      const app = createTestApp();
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "wrong" }),
      });
      expect(res.status).toBe(401);
    });

    test("returns 401 on wrong username", async () => {
      const app = createTestApp();
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "wrong", password: "secret" }),
      });
      expect(res.status).toBe(401);
    });

    test("returns 429 after rate limit exceeded", async () => {
      const app = createTestApp();
      for (let i = 0; i < 5; i++) {
        await app.request("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Forwarded-For": "1.2.3.4" },
          body: JSON.stringify({ username: "admin", password: "wrong" }),
        });
      }
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "1.2.3.4" },
        body: JSON.stringify({ username: "admin", password: "secret" }),
      });
      expect(res.status).toBe(429);
    });

    test("rate limit is per-IP", async () => {
      const app = createTestApp();
      for (let i = 0; i < 5; i++) {
        await app.request("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Forwarded-For": "1.2.3.4" },
          body: JSON.stringify({ username: "admin", password: "wrong" }),
        });
      }
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "5.6.7.8" },
        body: JSON.stringify({ username: "admin", password: "secret" }),
      });
      expect(res.status).toBe(200);
    });
  });

  // Bun test strips Cookie headers from Request objects. We work around this
  // by injecting cookies via an X-Test-Cookie header + middleware shim.

  describe("POST /api/auth/refresh", () => {
    test("returns new access token for valid refresh token", async () => {
      insertRefreshToken("valid-refresh-token");
      const app = createAppWithCookie();
      const res = await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "x-test-cookie": "shire_refresh=valid-refresh-token" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { accessToken: string; username: string };
      expect(body.accessToken).toBeTruthy();
      expect(body.username).toBe("admin");
    });

    test("extends expiry on refresh", async () => {
      insertRefreshToken("extend-token", 100);
      const db = getDb();
      const before = db.select().from(refreshTokens).all()[0];

      const app = createAppWithCookie();
      await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "x-test-cookie": "shire_refresh=extend-token" },
      });

      const after = db.select().from(refreshTokens).all()[0];
      expect(new Date(after.expiresAt).getTime()).toBeGreaterThan(
        new Date(before.expiresAt).getTime(),
      );
    });

    test("returns 401 when no cookie", async () => {
      const app = createAppWithCookie();
      const res = await app.request("/api/auth/refresh", { method: "POST" });
      expect(res.status).toBe(401);
    });

    test("returns 401 for nonexistent token", async () => {
      const app = createAppWithCookie();
      const res = await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "x-test-cookie": "shire_refresh=nonexistent" },
      });
      expect(res.status).toBe(401);
    });

    test("returns 401 for expired token", async () => {
      insertRefreshToken("expired-token", -1);
      const app = createAppWithCookie();
      const res = await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "x-test-cookie": "shire_refresh=expired-token" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/auth/logout", () => {
    test("deletes refresh token from database", async () => {
      insertRefreshToken("logout-token");
      const app = createAppWithCookie();
      const res = await app.request("/api/auth/logout", {
        method: "POST",
        headers: { "x-test-cookie": "shire_refresh=logout-token" },
      });
      expect(res.status).toBe(204);
      const db = getDb();
      expect(db.select().from(refreshTokens).all()).toHaveLength(0);
    });

    test("succeeds even without cookie", async () => {
      const app = createAppWithCookie();
      const res = await app.request("/api/auth/logout", { method: "POST" });
      expect(res.status).toBe(204);
    });
  });

  describe("GET /api/auth/me", () => {
    test("returns username from valid access token", async () => {
      const app = createTestApp();
      const token = await makeAccessToken();
      const res = await app.request("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { username: string };
      expect(body.username).toBe("admin");
    });

    test("returns 401 without token", async () => {
      const app = createTestApp();
      const res = await app.request("/api/auth/me");
      expect(res.status).toBe(401);
    });

    test("returns 401 for invalid token (via middleware)", async () => {
      const app = createTestApp();
      const res = await app.request("/api/auth/me", {
        headers: { Authorization: "Bearer invalid.jwt.token" },
      });
      expect(res.status).toBe(401);
    });
  });
});
