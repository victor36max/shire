import { eq, desc } from "drizzle-orm";
import { getDb, schema, type Db } from "../db";
import type { NewScheduledTask } from "../db/schema";

const { scheduledTasks, agents } = schema;

export function listScheduledTasks(projectId: string) {
  return getDb()
    .select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.projectId, projectId))
    .leftJoin(agents, eq(scheduledTasks.agentId, agents.id))
    .orderBy(desc(scheduledTasks.createdAt))
    .all();
}

export function getScheduledTask(id: string) {
  return getDb()
    .select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.id, id))
    .leftJoin(agents, eq(scheduledTasks.agentId, agents.id))
    .get();
}

export function createScheduledTask(attrs: NewScheduledTask) {
  return getDb().insert(scheduledTasks).values(attrs).returning().get();
}

export function updateScheduledTask(id: string, attrs: Partial<NewScheduledTask>) {
  return getDb()
    .update(scheduledTasks)
    .set({ ...attrs, updatedAt: new Date().toISOString() })
    .where(eq(scheduledTasks.id, id))
    .returning()
    .get();
}

export function deleteScheduledTask(id: string) {
  return getDb().delete(scheduledTasks).where(eq(scheduledTasks.id, id)).returning().get();
}

export function toggleScheduledTask(id: string, enabled: boolean, db?: Db) {
  return (db ?? getDb())
    .update(scheduledTasks)
    .set({ enabled, updatedAt: new Date().toISOString() })
    .where(eq(scheduledTasks.id, id))
    .returning()
    .get();
}

export function markRun(id: string, db?: Db) {
  const now = new Date().toISOString();
  return (db ?? getDb())
    .update(scheduledTasks)
    .set({ lastRunAt: now, updatedAt: now })
    .where(eq(scheduledTasks.id, id))
    .returning()
    .get();
}

export function listEnabledTasks() {
  return getDb()
    .select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.enabled, true))
    .leftJoin(agents, eq(scheduledTasks.agentId, agents.id))
    .all();
}
