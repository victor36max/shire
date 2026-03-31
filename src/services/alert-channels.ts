import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { AlertChannelConfig } from "../db/schema";

const { alertChannels } = schema;

export function getAlertChannel(projectId: string) {
  return getDb().select().from(alertChannels).where(eq(alertChannels.projectId, projectId)).get();
}

export function upsertAlertChannel(
  projectId: string,
  attrs: { config: AlertChannelConfig; enabled?: boolean },
) {
  const existing = getAlertChannel(projectId);
  const channelType = attrs.config.type;
  if (existing) {
    return getDb()
      .update(alertChannels)
      .set({ ...attrs, channelType, updatedAt: new Date().toISOString() })
      .where(eq(alertChannels.id, existing.id))
      .returning()
      .get();
  }
  return getDb()
    .insert(alertChannels)
    .values({ ...attrs, channelType, projectId })
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
