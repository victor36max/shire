import type { MiddlewareHandler } from "hono";
import { jwtVerify } from "jose";
import type { AppEnv } from "../types";
import { isAuthEnabled, getJwtSecret } from "../lib/auth-config";

const BEARER_PREFIX = "Bearer ";

const PUBLIC_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/config",
  "/api/health",
]);

export function authMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!isAuthEnabled()) return next();
    if (PUBLIC_PATHS.has(c.req.path)) return next();

    const header = c.req.header("Authorization");
    if (!header?.startsWith(BEARER_PREFIX)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const token = header.slice(BEARER_PREFIX.length);
    try {
      const secret = new TextEncoder().encode(getJwtSecret());
      const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
      c.set("username", payload.sub ?? null);
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }

    return next();
  };
}
