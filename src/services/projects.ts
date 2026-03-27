import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";

const { projects } = schema;

export function listProjects() {
  return getDb().select().from(projects).orderBy(projects.name).all();
}

export function getProject(id: string) {
  return getDb().select().from(projects).where(eq(projects.id, id)).get();
}

export function getProjectByName(name: string) {
  return getDb().select().from(projects).where(eq(projects.name, name)).get();
}

export function createProject(name: string) {
  return getDb().insert(projects).values({ name }).returning().get();
}

export function renameProject(id: string, name: string) {
  return getDb()
    .update(projects)
    .set({ name, updatedAt: new Date().toISOString() })
    .where(eq(projects.id, id))
    .returning()
    .get();
}

export function deleteProject(id: string) {
  return getDb().delete(projects).where(eq(projects.id, id)).returning().get();
}
