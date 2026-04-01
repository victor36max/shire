import { sqliteTable, text, integer, unique, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// $defaultFn produces ISO 8601 with Z suffix (e.g. "2026-04-01T12:00:00.000Z").
// .default(sql`...`) is the SQL-level fallback baked into the table DDL — Drizzle never
// uses it (the JS $defaultFn always wins), but removing it would trigger a destructive
// DROP/CREATE migration because SQLite has no ALTER COLUMN DEFAULT.
const utcNow = () => new Date().toISOString();

export const projects = sqliteTable("projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`)
    .$defaultFn(utcNow),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`)
    .$defaultFn(utcNow),
});

export const agents = sqliteTable(
  "agents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sessionId: text("session_id"),
    description: text("description"),
    harness: text("harness"),
    model: text("model"),
    systemPrompt: text("system_prompt"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`)
      .$defaultFn(utcNow),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`)
      .$defaultFn(utcNow),
  },
  (t) => [unique("agents_project_name").on(t.projectId, t.name)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`)
      .$defaultFn(utcNow),
  },
  (t) => [index("idx_messages_agent").on(t.projectId, t.agentId, t.id)],
);

export const scheduledTasks = sqliteTable("scheduled_tasks", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  message: text("message").notNull(),
  scheduleType: text("schedule_type").notNull().$type<"once" | "recurring">(),
  cronExpression: text("cron_expression"),
  scheduledAt: text("scheduled_at"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: text("last_run_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`)
    .$defaultFn(utcNow),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`)
    .$defaultFn(utcNow),
});

export type AlertSeverity = "info" | "success" | "warning" | "error";
export const ALERT_SEVERITIES: AlertSeverity[] = ["info", "success", "warning", "error"];

export type DiscordChannelConfig = { type: "discord"; webhookUrl: string };
export type SlackChannelConfig = { type: "slack"; webhookUrl: string };
export type TelegramChannelConfig = { type: "telegram"; botToken: string; chatId: string };
export type AlertChannelConfig = DiscordChannelConfig | SlackChannelConfig | TelegramChannelConfig;

export const CHANNEL_TYPES = ["discord", "slack", "telegram"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const alertChannels = sqliteTable("alert_channels", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id")
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: "cascade" }),
  channelType: text("channel_type").notNull().$type<ChannelType>(),
  config: text("config", { mode: "json" }).notNull().$type<AlertChannelConfig>(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`)
    .$defaultFn(utcNow),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`)
    .$defaultFn(utcNow),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type ScheduledTask = typeof scheduledTasks.$inferSelect;
export type NewScheduledTask = typeof scheduledTasks.$inferInsert;
export type AlertChannel = typeof alertChannels.$inferSelect;
export type NewAlertChannel = typeof alertChannels.$inferInsert;
