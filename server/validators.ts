/**
 * Centralized Server-Side Input Validation for Momentum V2 API
 * Enforces strict validation, formats, limits, and sanitization.
 */
import { ApiError } from "./errors.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const ALLOWED_PRIORITIES = ["low", "medium", "high"] as const;
export const ALLOWED_RECURRENCES = ["none", "daily", "weekdays", "weekly", "monthly"] as const;
export const ALLOWED_REMINDERS = ["0", "15", "60", "1440"] as const;
export const ALLOWED_THEMES = ["dark", "light", "system"] as const;
export const ALLOWED_SORT_PREFERENCES = ["smart", "dueDate", "priority", "newest", "oldest"] as const;

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

export function validateUuid(value: unknown, fieldName: string): string {
  if (!isValidUuid(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", `Invalid UUID format for field '${fieldName}'`);
  }
  return value;
}

export function validateOptionalUuid(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (!isValidUuid(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", `Invalid UUID format for field '${fieldName}'`);
  }
  return value;
}

export function validateVersion(value: unknown, fieldName = "version"): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `Field '${fieldName}' is required and must be a positive integer >= 1`
    );
  }
  return value;
}

export function normalizeTag(rawTag: unknown): string {
  if (typeof rawTag !== "string") {
    throw new ApiError(400, "VALIDATION_ERROR", "Tags must be strings");
  }
  const trimmed = rawTag.trim().toLowerCase();
  if (trimmed.length === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Tag cannot be empty or whitespace only");
  }
  if (trimmed.length > 50) {
    throw new ApiError(400, "VALIDATION_ERROR", `Tag '${trimmed.slice(0, 20)}...' exceeds maximum length of 50 characters`);
  }
  return trimmed;
}

export function validateTags(rawTags: unknown): string[] {
  if (rawTags === undefined || rawTags === null) return [];
  if (!Array.isArray(rawTags)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Field 'tags' must be an array of strings");
  }
  if (rawTags.length > 20) {
    throw new ApiError(400, "VALIDATION_ERROR", "A task cannot have more than 20 tags");
  }
  const normalizedSet = new Set<string>();
  for (const tag of rawTags) {
    normalizedSet.add(normalizeTag(tag));
  }
  return Array.from(normalizedSet);
}

// -----------------------------------------------------------------------------
// Display Name Validation
// -----------------------------------------------------------------------------

/**
 * Validates and normalizes a Momentum display name.
 * - Trims whitespace
 * - Rejects empty result
 * - Counts Unicode codepoints (not bytes) — max 50 codepoints
 * - Accepts international names, punctuation, accents, scripts
 * - Rejects ASCII/Unicode control characters and line breaks
 */
export function validateDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "VALIDATION_ERROR", "displayName must be a string");
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "displayName cannot be empty");
  }

  // Count Unicode codepoints using spread (handles surrogate pairs correctly)
  const codepoints = [...trimmed];
  if (codepoints.length > 50) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "displayName must be 50 characters or fewer"
    );
  }

  // Reject control characters (U+0000–U+001F, U+007F–U+009F) and vertical whitespace
  // This covers line feeds, carriage returns, tabs, null bytes, etc.
  if (/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/.test(trimmed)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "displayName contains invalid characters"
    );
  }

  return trimmed;
}

// -----------------------------------------------------------------------------
// Project Validation
// -----------------------------------------------------------------------------
export interface ValidatedProjectInput {
  name?: string;
  color?: string;
  version?: number;
}

export function validateProjectInput(body: any, isUpdate = false): ValidatedProjectInput {
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "VALIDATION_ERROR", "Request body must be a JSON object");
  }

  const result: ValidatedProjectInput = {};

  if (!isUpdate || body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      throw new ApiError(400, "VALIDATION_ERROR", "Project 'name' is required and must not be empty");
    }
    const trimmed = body.name.trim();
    if (trimmed.length > 100) {
      throw new ApiError(400, "VALIDATION_ERROR", "Project 'name' cannot exceed 100 characters");
    }
    result.name = trimmed;
  }

  if (body.color !== undefined) {
    if (typeof body.color !== "string" || !HEX_COLOR_REGEX.test(body.color.trim())) {
      throw new ApiError(400, "VALIDATION_ERROR", "Project 'color' must be a valid hex color code (e.g. #f08352)");
    }
    result.color = body.color.trim();
  }

  if (isUpdate) {
    result.version = validateVersion(body.version);
  }

  return result;
}

// -----------------------------------------------------------------------------
// Subtask Validation
// -----------------------------------------------------------------------------
export interface ValidatedSubtaskInput {
  id?: string;
  title?: string;
  completed?: boolean;
  position?: number;
  version?: number;
}

export function validateSubtaskInput(body: any, isUpdate = false): ValidatedSubtaskInput {
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "VALIDATION_ERROR", "Request body must be a JSON object");
  }

  const result: ValidatedSubtaskInput = {};

  if (body.id !== undefined) {
    result.id = validateUuid(body.id, "id");
  }

  if (!isUpdate || body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      throw new ApiError(400, "VALIDATION_ERROR", "Subtask 'title' is required and must not be empty");
    }
    const trimmed = body.title.trim();
    if (trimmed.length > 255) {
      throw new ApiError(400, "VALIDATION_ERROR", "Subtask 'title' cannot exceed 255 characters");
    }
    result.title = trimmed;
  }

  if (body.completed !== undefined) {
    if (typeof body.completed !== "boolean") {
      throw new ApiError(400, "VALIDATION_ERROR", "Subtask 'completed' must be a boolean");
    }
    result.completed = body.completed;
  }

  if (body.position !== undefined) {
    if (typeof body.position !== "number" || !Number.isInteger(body.position) || body.position < 0) {
      throw new ApiError(400, "VALIDATION_ERROR", "Subtask 'position' must be a non-negative integer");
    }
    result.position = body.position;
  }

  if (isUpdate) {
    result.version = validateVersion(body.version);
  }

  return result;
}

// -----------------------------------------------------------------------------
// Task Validation
// -----------------------------------------------------------------------------
export interface ValidatedTaskInput {
  id?: string;
  title?: string;
  description?: string;
  priority?: "low" | "medium" | "high";
  dueDate?: string | null;
  dueTime?: string | null;
  projectId?: string | null;
  completed?: boolean;
  completedAt?: Date | null;
  notes?: string;
  reminder?: string | null;
  recurrence?: "none" | "daily" | "weekdays" | "weekly" | "monthly";
  recurrenceSeriesId?: string | null;
  generatedNextOccurrenceId?: string | null;
  tags?: string[];
  subtasks?: ValidatedSubtaskInput[];
  version?: number;
}

export function validateTaskInput(body: any, isUpdate = false): ValidatedTaskInput {
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "VALIDATION_ERROR", "Request body must be a JSON object");
  }

  const result: ValidatedTaskInput = {};

  if (body.id !== undefined) {
    result.id = validateUuid(body.id, "id");
  }

  if (!isUpdate || body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      throw new ApiError(400, "VALIDATION_ERROR", "Task 'title' is required and must not be empty");
    }
    const trimmed = body.title.trim();
    if (trimmed.length > 255) {
      throw new ApiError(400, "VALIDATION_ERROR", "Task 'title' cannot exceed 255 characters");
    }
    result.title = trimmed;
  }

  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      throw new ApiError(400, "VALIDATION_ERROR", "Task 'description' must be a string");
    }
    result.description = body.description;
  }

  if (body.priority !== undefined) {
    if (typeof body.priority !== "string" || !ALLOWED_PRIORITIES.includes(body.priority as any)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `Invalid 'priority'. Allowed values: ${ALLOWED_PRIORITIES.join(", ")}`
      );
    }
    result.priority = body.priority as any;
  }

  if (body.dueDate !== undefined) {
    if (body.dueDate === null || body.dueDate === "") {
      result.dueDate = null;
    } else if (typeof body.dueDate === "string" && DATE_REGEX.test(body.dueDate)) {
      // Validate logical calendar date (e.g. not 2026-02-31)
      const [year, month, day] = body.dueDate.split("-").map(Number);
      const d = new Date(year, month - 1, day);
      if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
        throw new ApiError(400, "VALIDATION_ERROR", `Invalid calendar date '${body.dueDate}'`);
      }
      result.dueDate = body.dueDate;
    } else {
      throw new ApiError(400, "VALIDATION_ERROR", "Task 'dueDate' must be in YYYY-MM-DD format or null");
    }
  }

  if (body.dueTime !== undefined) {
    if (body.dueTime === null || body.dueTime === "") {
      result.dueTime = null;
    } else if (typeof body.dueTime === "string" && TIME_REGEX.test(body.dueTime)) {
      result.dueTime = body.dueTime;
    } else {
      throw new ApiError(400, "VALIDATION_ERROR", "Task 'dueTime' must be in HH:MM format or null");
    }
  }

  if (body.projectId !== undefined) {
    result.projectId = validateOptionalUuid(body.projectId, "projectId");
  }

  if (body.completed !== undefined) {
    if (typeof body.completed !== "boolean") {
      throw new ApiError(400, "VALIDATION_ERROR", "Task 'completed' must be a boolean");
    }
    result.completed = body.completed;
  }

  if (body.completedAt !== undefined) {
    if (body.completedAt === null || body.completedAt === "") {
      result.completedAt = null;
    } else if (typeof body.completedAt === "string" || body.completedAt instanceof Date) {
      const d = new Date(body.completedAt);
      if (isNaN(d.getTime())) {
        throw new ApiError(400, "VALIDATION_ERROR", "Invalid timestamp for 'completedAt'");
      }
      result.completedAt = d;
    } else {
      throw new ApiError(400, "VALIDATION_ERROR", "Task 'completedAt' must be an ISO timestamp or null");
    }
  }

  if (body.notes !== undefined) {
    if (typeof body.notes !== "string") {
      throw new ApiError(400, "VALIDATION_ERROR", "Task 'notes' must be a string");
    }
    result.notes = body.notes;
  }

  if (body.reminder !== undefined) {
    if (body.reminder === null || body.reminder === "") {
      result.reminder = null;
    } else if (typeof body.reminder === "string" && ALLOWED_REMINDERS.includes(body.reminder as any)) {
      result.reminder = body.reminder;
    } else {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `Invalid 'reminder'. Allowed values: ${ALLOWED_REMINDERS.join(", ")} or null`
      );
    }
  }

  if (body.recurrence !== undefined) {
    if (typeof body.recurrence !== "string" || !ALLOWED_RECURRENCES.includes(body.recurrence as any)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `Invalid 'recurrence'. Allowed values: ${ALLOWED_RECURRENCES.join(", ")}`
      );
    }
    result.recurrence = body.recurrence as any;
  }

  if (body.recurrenceSeriesId !== undefined) {
    result.recurrenceSeriesId = validateOptionalUuid(body.recurrenceSeriesId, "recurrenceSeriesId");
  }

  if (body.generatedNextOccurrenceId !== undefined) {
    result.generatedNextOccurrenceId = validateOptionalUuid(body.generatedNextOccurrenceId, "generatedNextOccurrenceId");
  }

  if (body.tags !== undefined) {
    result.tags = validateTags(body.tags);
  }

  if (!isUpdate && body.subtasks !== undefined) {
    if (!Array.isArray(body.subtasks)) {
      throw new ApiError(400, "VALIDATION_ERROR", "Field 'subtasks' must be an array of subtask objects");
    }
    result.subtasks = body.subtasks.map((s: any) => validateSubtaskInput(s, false));
  }

  if (isUpdate) {
    result.version = validateVersion(body.version);
  }

  return result;
}

// -----------------------------------------------------------------------------
// Settings Validation
// -----------------------------------------------------------------------------
export interface ValidatedSettingsInput {
  theme?: "dark" | "light" | "system";
  sortPreference?: "smart" | "dueDate" | "priority" | "newest" | "oldest";
  version?: number;
}

export function validateSettingsInput(body: any, isUpdate = false): ValidatedSettingsInput {
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "VALIDATION_ERROR", "Request body must be a JSON object");
  }

  const result: ValidatedSettingsInput = {};

  if (body.theme !== undefined) {
    if (typeof body.theme !== "string" || !ALLOWED_THEMES.includes(body.theme as any)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `Invalid 'theme'. Allowed values: ${ALLOWED_THEMES.join(", ")}`
      );
    }
    result.theme = body.theme as any;
  }

  if (body.sortPreference !== undefined) {
    if (typeof body.sortPreference !== "string" || !ALLOWED_SORT_PREFERENCES.includes(body.sortPreference as any)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `Invalid 'sortPreference'. Allowed values: ${ALLOWED_SORT_PREFERENCES.join(", ")}`
      );
    }
    result.sortPreference = body.sortPreference as any;
  }

  if (isUpdate) {
    result.version = validateVersion(body.version);
  }

  return result;
}

// -----------------------------------------------------------------------------
// Workspace Import Validation (Stage 4E)
// -----------------------------------------------------------------------------
export const MAX_IMPORT_PROJECTS = 100;
export const MAX_IMPORT_TASKS = 2000;
export const MAX_IMPORT_SUBTASKS_PER_TASK = 50;
export const MAX_IMPORT_TOTAL_SUBTASKS = 10000;

export interface ValidatedImportProject {
  id: string;
  name: string;
  color: string;
  createdAt: Date | null;
}

export interface ValidatedImportSubtask {
  id: string;
  title: string;
  completed: boolean;
  position: number;
  createdAt: Date | null;
}

export interface ValidatedImportTask {
  id: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  dueDate: string | null;
  dueTime: string | null;
  projectId: string | null;
  tags: string[];
  completed: boolean;
  completedAt: Date | null;
  subtasks: ValidatedImportSubtask[];
  notes: string;
  reminder: string | null;
  recurrence: "none" | "daily" | "weekdays" | "weekly" | "monthly";
  recurrenceSeriesId: string | null;
  generatedNextOccurrenceId: string | null;
  createdAt: Date | null;
}

export interface ValidatedWorkspaceImportInput {
  importId: string;
  source: string;
  workspace: {
    projects: ValidatedImportProject[];
    tasks: ValidatedImportTask[];
  };
}

export function validateWorkspaceImportInput(body: any): ValidatedWorkspaceImportInput {
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "VALIDATION_ERROR", "Request body must be a JSON object");
  }

  const importId = validateUuid(body.importId, "importId");
  const source = typeof body.source === "string" && body.source.trim().length > 0
    ? body.source.trim().slice(0, 50)
    : "momentum-local-v2";

  const workspaceObj = (body.workspace && typeof body.workspace === "object")
    ? body.workspace
    : body;

  const rawProjects = Array.isArray(workspaceObj.projects) ? workspaceObj.projects : [];
  const rawTasks = Array.isArray(workspaceObj.tasks) ? workspaceObj.tasks : [];

  if (rawProjects.length > MAX_IMPORT_PROJECTS) {
    throw new ApiError(400, "VALIDATION_ERROR", `Import exceeds maximum project limit of ${MAX_IMPORT_PROJECTS}`);
  }

  if (rawTasks.length > MAX_IMPORT_TASKS) {
    throw new ApiError(400, "VALIDATION_ERROR", `Import exceeds maximum task limit of ${MAX_IMPORT_TASKS}`);
  }

  // Validate Projects
  const validatedProjects: ValidatedImportProject[] = [];
  for (let i = 0; i < rawProjects.length; i++) {
    const p = rawProjects[i];
    if (!p || typeof p !== "object") {
      throw new ApiError(400, "VALIDATION_ERROR", `Invalid project object at index ${i}`);
    }

    if (typeof p.id !== "string" || p.id.trim().length === 0) {
      throw new ApiError(400, "VALIDATION_ERROR", `Project ID at index ${i} is required and must not be empty`);
    }
    const id = p.id.trim().slice(0, 255);

    if (typeof p.name !== "string" || p.name.trim().length === 0) {
      throw new ApiError(400, "VALIDATION_ERROR", `Project name at index ${i} is required and must not be empty`);
    }

    const name = p.name.trim().slice(0, 100);
    const color = typeof p.color === "string" && HEX_COLOR_REGEX.test(p.color.trim())
      ? p.color.trim()
      : "#f08352";

    let createdAt: Date | null = null;
    if (p.createdAt) {
      const d = new Date(p.createdAt);
      if (!isNaN(d.getTime())) createdAt = d;
    }

    validatedProjects.push({ id, name, color, createdAt });
  }

  // Validate Tasks & Subtasks
  let totalSubtasks = 0;
  const validatedTasks: ValidatedImportTask[] = [];

  for (let i = 0; i < rawTasks.length; i++) {
    const t = rawTasks[i];
    if (!t || typeof t !== "object") {
      throw new ApiError(400, "VALIDATION_ERROR", `Invalid task object at index ${i}`);
    }

    if (typeof t.id !== "string" || t.id.trim().length === 0) {
      throw new ApiError(400, "VALIDATION_ERROR", `Task ID at index ${i} is required and must not be empty`);
    }
    const id = t.id.trim().slice(0, 255);

    if (typeof t.title !== "string" || t.title.trim().length === 0) {
      throw new ApiError(400, "VALIDATION_ERROR", `Task title at index ${i} is required and must not be empty`);
    }

    const title = t.title.trim().slice(0, 255);
    const description = typeof t.description === "string" ? t.description : "";
    const priority = ALLOWED_PRIORITIES.includes(t.priority) ? t.priority : "medium";

    let dueDate: string | null = null;
    if (typeof t.dueDate === "string" && DATE_REGEX.test(t.dueDate)) {
      const [year, month, day] = t.dueDate.split("-").map(Number);
      const d = new Date(year, month - 1, day);
      if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) {
        dueDate = t.dueDate;
      }
    }

    let dueTime: string | null = null;
    if (typeof t.dueTime === "string" && TIME_REGEX.test(t.dueTime)) {
      dueTime = t.dueTime;
    }

    const projectId = typeof t.projectId === "string" && t.projectId.trim().length > 0
      ? t.projectId.trim().slice(0, 255)
      : null;
    const tags = validateTags(t.tags);
    const completed = Boolean(t.completed);

    let completedAt: Date | null = null;
    if (t.completedAt) {
      const d = new Date(t.completedAt);
      if (!isNaN(d.getTime())) completedAt = d;
    }

    const notes = typeof t.notes === "string" ? t.notes : "";
    const reminder = ALLOWED_REMINDERS.includes(t.reminder) ? t.reminder : null;
    const recurrence = ALLOWED_RECURRENCES.includes(t.recurrence) ? t.recurrence : "none";
    const recurrenceSeriesId = typeof t.recurrenceSeriesId === "string" && t.recurrenceSeriesId.trim().length > 0
      ? t.recurrenceSeriesId.trim().slice(0, 255)
      : null;
    const generatedNextOccurrenceId = typeof t.generatedNextOccurrenceId === "string" && t.generatedNextOccurrenceId.trim().length > 0
      ? t.generatedNextOccurrenceId.trim().slice(0, 255)
      : null;

    let createdAt: Date | null = null;
    if (t.createdAt) {
      const d = new Date(t.createdAt);
      if (!isNaN(d.getTime())) createdAt = d;
    }

    // Subtasks
    const rawSubtasks = Array.isArray(t.subtasks) ? t.subtasks : [];
    if (rawSubtasks.length > MAX_IMPORT_SUBTASKS_PER_TASK) {
      throw new ApiError(400, "VALIDATION_ERROR", `Task '${title}' exceeds limit of ${MAX_IMPORT_SUBTASKS_PER_TASK} subtasks`);
    }

    totalSubtasks += rawSubtasks.length;
    if (totalSubtasks > MAX_IMPORT_TOTAL_SUBTASKS) {
      throw new ApiError(400, "VALIDATION_ERROR", `Import exceeds total subtask limit of ${MAX_IMPORT_TOTAL_SUBTASKS}`);
    }

    const validatedSubtasks: ValidatedImportSubtask[] = [];
    for (let sIdx = 0; sIdx < rawSubtasks.length; sIdx++) {
      const s = rawSubtasks[sIdx];
      if (!s || typeof s !== "object") continue;

      const subtaskId = typeof s.id === "string" && s.id.trim().length > 0
        ? s.id.trim().slice(0, 255)
        : crypto.randomUUID();
      const subtaskTitle = typeof s.title === "string" && s.title.trim().length > 0
        ? s.title.trim().slice(0, 255)
        : "Untitled Subtask";

      let subCreatedAt: Date | null = null;
      if (s.createdAt) {
        const d = new Date(s.createdAt);
        if (!isNaN(d.getTime())) subCreatedAt = d;
      }

      validatedSubtasks.push({
        id: subtaskId,
        title: subtaskTitle,
        completed: Boolean(s.completed),
        position: typeof s.position === "number" && Number.isInteger(s.position) && s.position >= 0 ? s.position : sIdx,
        createdAt: subCreatedAt
      });
    }

    validatedTasks.push({
      id,
      title,
      description,
      priority,
      dueDate,
      dueTime,
      projectId,
      tags,
      completed,
      completedAt,
      subtasks: validatedSubtasks,
      notes,
      reminder,
      recurrence,
      recurrenceSeriesId,
      generatedNextOccurrenceId,
      createdAt
    });
  }

  return {
    importId,
    source,
    workspace: {
      projects: validatedProjects,
      tasks: validatedTasks
    }
  };
}

