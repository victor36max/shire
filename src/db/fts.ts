import type { Database } from "bun:sqlite";
import { getSqlite } from "./index";

export interface FtsResult {
  id: number;
  role: string;
  content: string;
  created_at: string;
  relevance: number;
}

/**
 * Search messages using FTS5 with BM25 ranking.
 * Returns messages matching the query, filtered by project and agent, ordered by relevance.
 */
export function searchMessages(
  projectId: string,
  agentId: string,
  query: string,
  limit = 10,
): FtsResult[] {
  const sqlite = getSqlite();
  const stmt = sqlite.query<FtsResult, [string, string, string, number]>(`
    SELECT m.id, m.role, m.content, m.created_at, f.rank AS relevance
    FROM messages_fts f
    JOIN messages m ON m.id = f.rowid
    WHERE messages_fts MATCH ?
      AND m.project_id = ?
      AND m.agent_id = ?
    ORDER BY f.rank
    LIMIT ?
  `);
  try {
    return stmt.all(query, projectId, agentId, limit);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid search query: ${message}`);
  }
}

/**
 * Backfill the FTS index with existing messages that were inserted before the FTS table existed.
 * Runs non-blocking and catches errors so it never blocks server startup.
 */
export function backfillFts(sqlite?: Database): void {
  const db = sqlite ?? getSqlite();
  try {
    db.exec(`
      INSERT INTO messages_fts(rowid, text)
      SELECT m.id, json_extract(m.content, '$.text')
      FROM messages m
      WHERE m.role IN ('user', 'agent', 'inter_agent')
        AND json_extract(m.content, '$.text') IS NOT NULL
        AND m.id NOT IN (SELECT rowid FROM messages_fts)
    `);
    const changes = db.query<{ changes: number }, []>("SELECT changes() as changes").get();
    if (changes && changes.changes > 0) {
      console.log(`FTS backfill: indexed ${changes.changes} existing messages`);
    }
  } catch (err) {
    console.error("FTS backfill error (non-fatal):", err);
  }
}
