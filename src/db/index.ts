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
let _sqlite: Database | null = null;

export function getDb() {
  if (!_db) {
    mkdirSync(DATA_DIR, { recursive: true });
    _sqlite = new Database(getDbPath());
    _sqlite.exec("PRAGMA journal_mode = WAL");
    _sqlite.exec("PRAGMA foreign_keys = ON");
    _db = drizzle(_sqlite, { schema });
  }
  return _db;
}

/** Get the raw bun:sqlite Database handle (for FTS5 and other raw SQL operations) */
export function getSqlite(): Database {
  if (!_sqlite) {
    getDb(); // ensures _sqlite is initialized
  }
  return _sqlite!;
}

/** Override the DB instance (used by tests to inject in-memory DB) */
export function setDb(db: ReturnType<typeof drizzle<typeof schema>>, sqlite: Database) {
  _db = db;
  _sqlite = sqlite;
}

export function getDataDir(): string {
  return DATA_DIR;
}

export type Db = BaseSQLiteDatabase<"sync", void, typeof schema>;

export { schema };
