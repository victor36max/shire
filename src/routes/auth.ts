import { timingSafeEqual as cryptoTimingSafeEqual, createHash } from "crypto";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { SignJWT } from "jose";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { eq, and, gt } from "drizzle-orm";
import type { AppEnv } from "../types";
import { getDb } from "../db";
import { refreshTokens } from "../db/schema";
import {
  getCredentials,
  getJwtSecret,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
} from "../lib/auth-config";

const REFRESH_COOKIE = "shire_refresh";
const DEV = process.env.NODE_ENV !== "production";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 5;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  for (const [key, entry] of loginAttempts) {
    if (now >= entry.resetAt) loginAttempts.delete(key);
  }
  const existing = loginAttempts.get(ip);
  if (!existing) {
    loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  existing.count++;
  return existing.count <= RATE_LIMIT_MAX;
}

function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "127.0.0.1"
  );
}

async function createAccessToken(username: string): Promise<string> {
  const secret = new TextEncoder().encode(getJwtSecret());
  return new SignJWT({ sub: username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(secret);
}

function timingSafeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return cryptoTimingSafeEqual(hashA, hashB);
}

function setRefreshCookie(c: Parameters<typeof setCookie>[0], token: string): void {
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "Strict",
    path: "/api/auth",
    maxAge: REFRESH_TOKEN_TTL,
    secure: !DEV,
  });
}

export const authRoutes = new Hono<AppEnv>()
  .post("/auth/login", zValidator("json", loginSchema), async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(ip)) {
      return c.json({ error: "Too many login attempts, try again later" }, 429);
    }

    const credentials = getCredentials();
    if (!credentials) {
      return c.json({ error: "Auth not enabled" }, 400);
    }

    const { username, password } = c.req.valid("json");
    const validUser = timingSafeEqual(username, credentials.username);
    const validPass = timingSafeEqual(password, credentials.password);
    if (!validUser || !validPass) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const db = getDb();
    const accessToken = await createAccessToken(username);
    const refreshToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000).toISOString();

    db.insert(refreshTokens).values({ token: refreshToken, expiresAt }).run();
    setRefreshCookie(c, refreshToken);

    return c.json({ accessToken, username });
  })
  .post("/auth/refresh", async (c) => {
    const oldToken = getCookie(c, REFRESH_COOKIE);
    if (!oldToken) {
      return c.json({ error: "No refresh token" }, 401);
    }

    const db = getDb();
    const row = db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.token, oldToken),
          gt(refreshTokens.expiresAt, new Date().toISOString()),
        ),
      )
      .get();

    if (!row) {
      deleteCookie(c, REFRESH_COOKIE, { path: "/api/auth" });
      return c.json({ error: "Invalid or expired refresh token" }, 401);
    }

    const credentials = getCredentials();
    if (!credentials) {
      return c.json({ error: "Auth configuration unavailable" }, 503);
    }

    const newToken = crypto.randomUUID();
    const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000).toISOString();
    db.update(refreshTokens)
      .set({ token: newToken, expiresAt: newExpiresAt })
      .where(eq(refreshTokens.token, oldToken))
      .run();

    const accessToken = await createAccessToken(credentials.username);
    setRefreshCookie(c, newToken);

    return c.json({ accessToken, username: credentials.username });
  })
  .post("/auth/logout", async (c) => {
    const token = getCookie(c, REFRESH_COOKIE);
    if (token) {
      const db = getDb();
      db.delete(refreshTokens).where(eq(refreshTokens.token, token)).run();
    }
    deleteCookie(c, REFRESH_COOKIE, { path: "/api/auth" });
    return c.body(null, 204);
  })
  .get("/auth/me", (c) => {
    return c.json({ username: c.get("username") });
  });

export { loginAttempts as _loginAttempts };
