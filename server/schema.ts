import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  date,
  time,
  integer,
  index,
  uniqueIndex,
  unique
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// =============================================================================
// 1. USERS TABLE
// =============================================================================
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authProviderId: varchar("auth_provider_id", { length: 255 }).notNull().unique(), // Immutable Clerk User ID
    email: varchar("email", { length: 320 }), // Mutable profile field
    displayName: varchar("display_name", { length: 255 }),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("idx_users_auth_provider").on(table.authProviderId)
  ]
);

// =============================================================================
// 2. USER SETTINGS TABLE (1:1 with Users)
// =============================================================================
export const userSettings = pgTable(
  "user_settings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    theme: varchar("theme", { length: 20 }).notNull().default("dark"),
    sortPreference: varchar("sort_preference", { length: 30 }).notNull().default("smart"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  }
);

// =============================================================================
// 3. PROJECTS TABLE
// =============================================================================
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    color: varchar("color", { length: 20 }).notNull().default("#f08352"),
    legacySource: varchar("legacy_source", { length: 50 }),
    legacyId: varchar("legacy_id", { length: 255 }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("idx_projects_user_created").on(table.userId, table.createdAt),
    uniqueIndex("idx_projects_user_legacy_unique")
      .on(table.userId, table.legacySource, table.legacyId)
      .where(sql`${table.legacyId} IS NOT NULL`)
  ]
);

// =============================================================================
// 4. TASKS TABLE
// =============================================================================
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull().default(""),
    priority: varchar("priority", { length: 20 }).notNull().default("medium"),
    dueDate: date("due_date"),
    dueTime: time("due_time"),
    completed: boolean("completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    notes: text("notes").notNull().default(""),
    reminder: varchar("reminder", { length: 20 }), // '0', '15', '60', '1440' or null
    recurrence: varchar("recurrence", { length: 20 }).notNull().default("none"),
    recurrenceSeriesId: uuid("recurrence_series_id"),
    generatedNextOccurrenceId: uuid("generated_next_occurrence_id"),
    legacySource: varchar("legacy_source", { length: 50 }),
    legacyId: varchar("legacy_id", { length: 255 }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("idx_tasks_user_filter").on(table.userId, table.completed, table.dueDate),
    index("idx_tasks_user_project").on(table.userId, table.projectId),
    index("idx_tasks_user_series").on(table.userId, table.recurrenceSeriesId),
    index("idx_tasks_user_updated").on(table.userId, table.updatedAt),
    // Recurrence Database Invariant: prevents duplicate occurrence generation in same series on same due date
    uniqueIndex("idx_tasks_recurrence_unique")
      .on(table.userId, table.recurrenceSeriesId, table.dueDate)
      .where(sql`${table.recurrenceSeriesId} IS NOT NULL AND ${table.dueDate} IS NOT NULL`),
    // Provenance Database Invariant: prevents duplicate import of the same local task under different import IDs
    uniqueIndex("idx_tasks_user_legacy_unique")
      .on(table.userId, table.legacySource, table.legacyId)
      .where(sql`${table.legacyId} IS NOT NULL`)
  ]
);

// =============================================================================
// 5. SUBTASKS TABLE
// =============================================================================
export const subtasks = pgTable(
  "subtasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    completed: boolean("completed").notNull().default(false),
    position: integer("position").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("idx_subtasks_task_pos").on(table.taskId, table.position),
    index("idx_subtasks_user").on(table.userId)
  ]
);

// =============================================================================
// 6. TASK TAGS TABLE (Normalized Relational Tags)
// =============================================================================
export const taskTags = pgTable(
  "task_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tag: varchar("tag", { length: 50 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("uq_task_tag").on(table.taskId, table.tag),
    index("idx_task_tags_user_tag").on(table.userId, table.tag)
  ]
);

// =============================================================================
// 7. WORKSPACE IMPORTS TABLE (Migration Tracking, Idempotency & Replay)
// =============================================================================
export const workspaceImports = pgTable(
  "workspace_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    importId: uuid("import_id").notNull(), // Client-generated idempotency UUID
    source: varchar("source", { length: 50 }).notNull().default("momentum-local-v2"),
    taskCount: integer("task_count").notNull().default(0),
    projectCount: integer("project_count").notNull().default(0),
    subtaskCount: integer("subtask_count").notNull().default(0),
    tagCount: integer("tag_count").notNull().default(0),
    remappedProjectCount: integer("remapped_project_count").notNull().default(0),
    remappedTaskCount: integer("remapped_task_count").notNull().default(0),
    remappedSubtaskCount: integer("remapped_subtask_count").notNull().default(0),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    status: varchar("status", { length: 20 }).notNull().default("completed")
  },
  (table) => [
    unique("uq_user_import_id").on(table.userId, table.importId),
    index("idx_workspace_imports_user").on(table.userId)
  ]
);

// Export types inferred from schema
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type UserSettings = typeof userSettings.$inferSelect;
export type NewUserSettings = typeof userSettings.$inferInsert;

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export type Subtask = typeof subtasks.$inferSelect;
export type NewSubtask = typeof subtasks.$inferInsert;

export type TaskTag = typeof taskTags.$inferSelect;
export type NewTaskTag = typeof taskTags.$inferInsert;

export type WorkspaceImport = typeof workspaceImports.$inferSelect;
export type NewWorkspaceImport = typeof workspaceImports.$inferInsert;
