import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { NewAlertChannel } from "../db/schema";

const { alertChannels } = schema;

export function getAlertChannel(projectId: string) {
  return getDb().select().from(alertChannels).where(eq(alertChannels.projectId, projectId)).get();
}

export function upsertAlertChannel(
  projectId: string,
  attrs: Omit<NewAlertChannel, "id" | "projectId" | "createdAt" | "updatedAt">,
) {
  const existing = getAlertChannel(projectId);
  if (existing) {
    return getDb()
      .update(alertChannels)
      .set({ ...attrs, updatedAt: new Date().toISOString() })
      .where(eq(alertChannels.id, existing.id))
      .returning()
      .get();
  }
  return getDb()
    .insert(alertChannels)
    .values({ ...attrs, projectId })
    .returning()
    .get();
}

export function deleteAlertChannel(projectId: string) {
  return getDb()
    .delete(alertChannels)
    .where(eq(alertChannels.projectId, projectId))
    .returning()
    .get();
}

export function hasAlertChannel(projectId: string): boolean {
  const row = getDb()
    .select({ id: alertChannels.id })
    .from(alertChannels)
    .where(and(eq(alertChannels.projectId, projectId), eq(alertChannels.enabled, true)))
    .get();
  return !!row;
}
