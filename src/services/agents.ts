import { and, eq, lt, desc, sql, inArray } from "drizzle-orm";
import { getDb, schema, type Db } from "../db";
import type { NewMessage } from "../db/schema";

const { agents, messages } = schema;

export function listAgents(projectId: string) {
  return getDb()
    .select()
    .from(agents)
    .where(eq(agents.projectId, projectId))
    .orderBy(agents.name)
    .all();
}

export function getAgent(id: string) {
  return getDb().select().from(agents).where(eq(agents.id, id)).get();
}

export function getAgentByName(projectId: string, name: string) {
  return getDb()
    .select()
    .from(agents)
    .where(and(eq(agents.projectId, projectId), eq(agents.name, name)))
    .get();
}

export function createAgent(
  projectId: string,
  data: {
    name: string;
    description?: string;
    harness?: string;
    model?: string;
    systemPrompt?: string;
  },
  db?: Db,
) {
  return (db ?? getDb())
    .insert(agents)
    .values({
      projectId,
      name: data.name,
      description: data.description,
      harness: data.harness,
      model: data.model,
      systemPrompt: data.systemPrompt,
    })
    .returning()
    .get();
}

export function updateAgent(
  id: string,
  fields: {
    name?: string;
    description?: string;
    harness?: string;
    model?: string;
    systemPrompt?: string;
  },
  db?: Db,
) {
  return (db ?? getDb())
    .update(agents)
    .set({ ...fields, updatedAt: new Date().toISOString() })
    .where(eq(agents.id, id))
    .returning()
    .get();
}

export function setSessionId(id: string, sessionId: string | null) {
  return getDb()
    .update(agents)
    .set({ sessionId, updatedAt: new Date().toISOString() })
    .where(eq(agents.id, id))
    .returning()
    .get();
}

export function deleteAgent(id: string, db?: Db) {
  return (db ?? getDb()).delete(agents).where(eq(agents.id, id)).returning().get();
}

export function createMessage(attrs: NewMessage, db?: Db) {
  return (db ?? getDb()).insert(messages).values(attrs).returning().get();
}

export function listMessages(
  projectId: string,
  agentId: string,
  opts: { before?: number; limit?: number } = {},
) {
  const limit = opts.limit ?? 50;
  const conditions = [eq(messages.projectId, projectId), eq(messages.agentId, agentId)];
  if (opts.before) {
    conditions.push(lt(messages.id, opts.before));
  }

  const rows = getDb()
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const result = rows.slice(0, limit).reverse();
  return { messages: result, hasMore };
}

export function listInterAgentMessages(
  projectId: string,
  opts: { before?: number; limit?: number } = {},
) {
  const limit = opts.limit ?? 50;
  const conditions = [
    eq(messages.projectId, projectId),
    inArray(messages.role, ["inter_agent", "system"]),
  ];
  if (opts.before) {
    conditions.push(lt(messages.id, opts.before));
  }

  const rows = getDb()
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  return { messages: rows.slice(0, limit), hasMore };
}

export function getMessage(id: number) {
  return getDb().select().from(messages).where(eq(messages.id, id)).get();
}

export function updateMessage(id: number, attrs: { content?: Record<string, unknown> }) {
  return getDb().update(messages).set(attrs).where(eq(messages.id, id)).returning().get();
}

export function latestAgentMessageId(agentId: string): number | null {
  const row = getDb()
    .select({ maxId: sql<number>`max(${messages.id})` })
    .from(messages)
    .where(and(eq(messages.agentId, agentId), eq(messages.role, "agent")))
    .get();
  return row?.maxId ?? null;
}

export function unreadCounts(
  agentIds: string[],
  lastReadIds: Map<string, number | null>,
): Map<string, number> {
  return getDb().transaction((tx) => {
    const counts = new Map<string, number>();
    for (const agentId of agentIds) {
      const lastRead = lastReadIds.get(agentId) ?? 0;
      const row = tx
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(
          and(
            eq(messages.agentId, agentId),
            eq(messages.role, "agent"),
            sql`${messages.id} > ${lastRead}`,
          ),
        )
        .get();
      counts.set(agentId, row?.count ?? 0);
    }
    return counts;
  });
}
