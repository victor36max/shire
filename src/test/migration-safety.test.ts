import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { sql } from "drizzle-orm";
import { join, dirname } from "path";
import * as schema from "../db/schema";

const __dirname = dirname(new URL(import.meta.url).pathname);
const MIGRATIONS_DIR = join(__dirname, "..", "..", "drizzle");

describe("migration safety", () => {
  it("preserves data when table-recreating migration runs on existing database", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    const db = drizzle(sqlite, { schema });

    // 1. Apply migrations 0000–0003 only (old schema with datetime('now') defaults)
    db.run(sql`PRAGMA foreign_keys = OFF`);
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    db.run(sql`PRAGMA foreign_keys = ON`);

    // 2. Seed data (simulating an existing database with user data)
    db.insert(schema.projects).values({ name: "my-project" }).run();
    const project = db.select().from(schema.projects).get()!;

    db.insert(schema.agents).values({ projectId: project.id, name: "agent-alpha" }).run();
    db.insert(schema.agents).values({ projectId: project.id, name: "agent-beta" }).run();
    const agents = db.select().from(schema.agents).all();

    db.insert(schema.messages)
      .values({
        projectId: project.id,
        agentId: agents[0].id,
        role: "user",
        content: { text: "hello" },
      })
      .run();
    db.insert(schema.messages)
      .values({
        projectId: project.id,
        agentId: agents[1].id,
        role: "agent",
        content: { text: "hi back" },
      })
      .run();

    // 3. Re-run migrate (only 0004 will apply since 0000-0003 are already recorded).
    //    This is the table-recreating migration — without FK guard it would cascade-delete.
    db.run(sql`PRAGMA foreign_keys = OFF`);
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    db.run(sql`PRAGMA foreign_keys = ON`);

    // 4. Assert all data survived the DROP TABLE / CREATE TABLE migration
    expect(db.select().from(schema.projects).all()).toHaveLength(1);
    expect(db.select().from(schema.agents).all()).toHaveLength(2);
    expect(db.select().from(schema.messages).all()).toHaveLength(2);

    // Verify new default produces correct format
    db.insert(schema.agents).values({ projectId: project.id, name: "agent-gamma" }).run();
    const newAgent = db
      .select()
      .from(schema.agents)
      .where(sql`name = 'agent-gamma'`)
      .get()!;
    expect(newAgent.createdAt).toMatch(/Z$/);
  });
});
