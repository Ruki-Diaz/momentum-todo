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
