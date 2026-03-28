import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";

const DATA_DIR = process.env.SHIRE_DATA_DIR || join(homedir(), ".shire");

export function getDbPath(): string {
  return join(DATA_DIR, "shire.db");
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    mkdirSync(DATA_DIR, { recursive: true });
    const sqlite = new Database(getDbPath());
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA foreign_keys = ON");
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

/** Override the DB instance (used by tests to inject in-memory DB) */
export function setDb(db: ReturnType<typeof drizzle<typeof schema>>) {
  _db = db;
}

export function getDataDir(): string {
  return DATA_DIR;
}

export type Db = BaseSQLiteDatabase<"sync", void, typeof schema>;

export { schema };
