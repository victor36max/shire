import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { join, dirname } from "path";
import * as schema from "../db/schema";
import { setDb } from "../db";
import { beforeEach } from "bun:test";

const __dirname = dirname(new URL(import.meta.url).pathname);
const MIGRATIONS_DIR = join(__dirname, "..", "..", "drizzle");

export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  setDb(db);
  return db;
}

export function useTestDb() {
  beforeEach(() => {
    createTestDb();
  });
}
