import type { Database } from "bun:sqlite";
import { getSqlite } from "./index";

export interface FtsResult {
  id: number;
  role: string;
  content: string;
  created_at: string;
  relevance: number;
}

export interface SearchMessagesOptions {
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
}

/**
 * Search messages using FTS5 with BM25 ranking.
 * Returns messages matching the query, filtered by project/agent and optional
 * date range, ordered by relevance. Supports pagination via `limit` + `offset`.
 */
export function searchMessages(
  projectId: string,
  agentId: string,
  query: string,
  options: SearchMessagesOptions = {},
): FtsResult[] {
  const { limit = 10, offset = 0, startDate } = options;
  let { endDate } = options;

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("limit must be a positive integer");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("offset must be a non-negative integer");
  }
  if (startDate !== undefined && Number.isNaN(Date.parse(startDate))) {
    throw new Error(`Invalid startDate: ${startDate}`);
  }
  if (endDate !== undefined && Number.isNaN(Date.parse(endDate))) {
    throw new Error(`Invalid endDate: ${endDate}`);
  }

  // Timestamps are stored as full ISO-8601 (e.g. "2026-04-30T12:34:56.789Z") and
  // compared lexicographically. A date-only endDate like "2026-04-30" would wrongly
  // exclude every message later that same day, so extend it to end-of-day.
  if (endDate !== undefined && !endDate.includes("T")) {
    endDate = `${endDate}T23:59:59.999Z`;
  }

  const conditions: string[] = ["messages_fts MATCH ?", "m.project_id = ?", "m.agent_id = ?"];
  const params: (string | number)[] = [query, projectId, agentId];

  if (startDate !== undefined) {
    conditions.push("m.created_at >= ?");
    params.push(startDate);
  }
  if (endDate !== undefined) {
    conditions.push("m.created_at <= ?");
    params.push(endDate);
  }

  params.push(limit, offset);

  const sql = `
    SELECT m.id, m.role, m.content, m.created_at, f.rank AS relevance
    FROM messages_fts f
    JOIN messages m ON m.id = f.rowid
    WHERE ${conditions.join(" AND ")}
    ORDER BY f.rank
    LIMIT ? OFFSET ?
  `;

  const sqlite = getSqlite();
  try {
    return sqlite.query<FtsResult, (string | number)[]>(sql).all(...params);
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
