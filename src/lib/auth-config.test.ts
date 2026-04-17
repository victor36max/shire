import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { isAuthEnabled, getCredentials, getJwtSecret, resetCachedSecret } from "./auth-config";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("auth-config", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    resetCachedSecret();
    delete process.env.SHIRE_USERNAME;
    delete process.env.SHIRE_PASSWORD;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe("isAuthEnabled", () => {
    test("returns false when SHIRE_USERNAME is not set", () => {
      expect(isAuthEnabled()).toBe(false);
    });

    test("returns true when SHIRE_USERNAME is set", () => {
      process.env.SHIRE_USERNAME = "admin";
      expect(isAuthEnabled()).toBe(true);
    });
  });

  describe("getCredentials", () => {
    test("returns null when SHIRE_USERNAME is not set", () => {
      expect(getCredentials()).toBeNull();
    });

    test("returns credentials when both env vars are set", () => {
      process.env.SHIRE_USERNAME = "admin";
      process.env.SHIRE_PASSWORD = "secret";
      expect(getCredentials()).toEqual({ username: "admin", password: "secret" });
    });

    test("throws when SHIRE_USERNAME is set but SHIRE_PASSWORD is missing", () => {
      process.env.SHIRE_USERNAME = "admin";
      expect(() => getCredentials()).toThrow("SHIRE_PASSWORD must be set");
    });
  });

  describe("getJwtSecret", () => {
    test("generates and persists secret file", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "shire-test-"));
      process.env.SHIRE_DATA_DIR = tmpDir;

      const secret = getJwtSecret();
      expect(secret).toHaveLength(64);

      const fileContent = readFileSync(join(tmpDir, ".jwt-secret"), "utf-8");
      expect(fileContent).toBe(secret);

      rmSync(tmpDir, { recursive: true });
    });

    test("reads existing secret file on subsequent calls", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "shire-test-"));
      process.env.SHIRE_DATA_DIR = tmpDir;

      const first = getJwtSecret();
      resetCachedSecret();
      const second = getJwtSecret();
      expect(first).toBe(second);

      rmSync(tmpDir, { recursive: true });
    });

    test("caches secret in memory", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "shire-test-"));
      process.env.SHIRE_DATA_DIR = tmpDir;

      const first = getJwtSecret();
      const second = getJwtSecret();
      expect(first).toBe(second);

      rmSync(tmpDir, { recursive: true });
    });
  });
});
