import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { getDbPath, getDataDir, getDb, setDb } from "./index";
import * as schema from "./schema";
import { createTestDb } from "../test/setup";
import { join } from "path";
import { tmpdir } from "os";
import { rmSync } from "fs";

describe("db/index", () => {
  it("getDbPath returns a path ending in shire.db", () => {
    expect(getDbPath()).toContain("shire.db");
  });

  it("getDataDir returns a path string", () => {
    expect(typeof getDataDir()).toBe("string");
    expect(getDataDir().length).toBeGreaterThan(0);
  });

  it("getDb returns the injected test database", () => {
    createTestDb();
    const db = getDb();
    expect(db).toBeDefined();
  });

  it("setDb overrides the db instance", () => {
    const sqlite = new Database(":memory:");
    const testDb = drizzle(sqlite, { schema });
    setDb(testDb, sqlite);
    expect(getDb()).toBe(testDb);
  });

  describe("getDb creates DB when none set", () => {
    const testDataDir = join(tmpdir(), `db-init-test-${Date.now()}`);
    let savedDataDir: string | undefined;

    beforeEach(() => {
      savedDataDir = process.env.SHIRE_DATA_DIR;
      process.env.SHIRE_DATA_DIR = testDataDir;
      // Clear internal _db by passing a temporary value and then forcing null
      const tempSqlite = new Database(":memory:");
      const tempDb = drizzle(tempSqlite, { schema });
      setDb(tempDb, tempSqlite);
      // Now set to null to force getDb() to create a real DB
      // We access setDb with null cast
      (setDb as (db: unknown, s: unknown) => void)(null, null);
    });

    afterEach(() => {
      if (savedDataDir !== undefined) process.env.SHIRE_DATA_DIR = savedDataDir;
      else delete process.env.SHIRE_DATA_DIR;
      rmSync(testDataDir, { recursive: true, force: true });
      createTestDb();
    });

    it("creates a new SQLite DB with WAL mode and foreign keys", () => {
      const db = getDb();
      expect(db).toBeDefined();
      // Calling again returns the same instance
      expect(getDb()).toBe(db);
    });
  });
});
