/**
 * Momentum Intelligence — AI Response Validators
 *
 * Every AI response MUST be validated here before any UI or data operation.
 * Provider schema enforcement AND application validation are both required.
 * If validation fails: throw AIError (AI_RESPONSE_INVALID). Nothing is mutated.
 */

import { AIError } from "./errors.js";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const ALLOWED_PRIORITIES = ["low", "medium", "high"] as const;
const ALLOWED_RECURRENCES = ["none", "daily", "weekdays", "weekly", "monthly"] as const;
const ALLOWED_REMINDERS = ["0", "15", "60", "1440", null] as const;
const ALLOWED_INTENTS = [
  "CREATE_TASK",
  "SEARCH_TASKS",
  "UPDATE_TASK",
  "UPDATE_TASKS",
  "PLAN_DAY",
  "BREAK_DOWN_TASK",
  "CREATE_PROJECT_PLAN",
  "SHOW_BRIEFING",
  "SHOW_WEEKLY_REVIEW",
  "UNKNOWN"
] as const;

function invalidResponse(detail: string): never {
  throw new AIError(500, "AI_RESPONSE_INVALID", `AI response validation failed: ${detail}`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateString(v: unknown, field: string, maxLen = 255): string {
  if (typeof v !== "string") invalidResponse(`'${field}' must be a string`);
  if ((v as string).length > maxLen) invalidResponse(`'${field}' exceeds max length of ${maxLen}`);
  return (v as string).trim();
}

function validateOptionalString(v: unknown, field: string, maxLen = 255): string | null {
  if (v === null || v === undefined || v === "") return null;
  return validateString(v, field, maxLen);
}

function validatePriority(v: unknown, field = "priority"): "low" | "medium" | "high" {
  if (!ALLOWED_PRIORITIES.includes(v as any)) {
    invalidResponse(`'${field}' must be low|medium|high, got '${v}'`);
  }
  return v as "low" | "medium" | "high";
}

function validateOptionalDate(v: unknown, field: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !DATE_REGEX.test(v)) {
    invalidResponse(`'${field}' must be YYYY-MM-DD or null`);
  }
  return v;
}

function validateOptionalTime(v: unknown, field: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !TIME_REGEX.test(v)) {
    invalidResponse(`'${field}' must be HH:MM or null`);
  }
  return v;
}

function validateStringArray(v: unknown, field: string, maxItems = 10, maxItemLen = 50): string[] {
  if (!Array.isArray(v)) invalidResponse(`'${field}' must be an array`);
  if ((v as unknown[]).length > maxItems) invalidResponse(`'${field}' exceeds ${maxItems} items`);
  return (v as unknown[]).map((item, i) => validateString(item, `${field}[${i}]`, maxItemLen));
}

// ---------------------------------------------------------------------------
// Parse Task Proposal
// ---------------------------------------------------------------------------

export interface ParsedTaskProposal {
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  dueDate: string | null;
  dueTime: string | null;
  projectHint: string | null;
  tags: string[];
  reminder: string | null;
  recurrence: "none" | "daily" | "weekdays" | "weekly" | "monthly";
}

export function validateParseTaskResponse(raw: unknown): ParsedTaskProposal {
  if (!isObject(raw) || !isObject(raw.proposal)) invalidResponse("missing 'proposal' object");
  const p = raw.proposal as Record<string, unknown>;
  const recurrence = (p.recurrence as string) || "none";
  if (!ALLOWED_RECURRENCES.includes(recurrence as any)) {
    invalidResponse(`invalid recurrence '${recurrence}'`);
  }
  const reminder = p.reminder === undefined ? null : p.reminder;
  if (!ALLOWED_REMINDERS.includes(reminder as any)) {
    invalidResponse(`invalid reminder '${reminder}'`);
  }
  return {
    title: validateString(p.title, "title", 255),
    description: validateOptionalString(p.description, "description", 1000) ?? "",
    priority: validatePriority(p.priority),
    dueDate: validateOptionalDate(p.dueDate, "dueDate"),
    dueTime: validateOptionalTime(p.dueTime, "dueTime"),
    projectHint: validateOptionalString(p.projectHint, "projectHint", 100),
    tags: validateStringArray(p.tags ?? [], "tags", 10, 50),
    reminder: (reminder as string | null) ?? null,
    recurrence: recurrence as any
  };
}

// ---------------------------------------------------------------------------
// Plan My Day
// ---------------------------------------------------------------------------

export interface DayPlanBlock {
  startTime: string | null;
  endTime: string | null;
  taskRef: string | null;
  title: string;
  notes: string | null;
}

export interface DayPlan {
  date: string;
  blocks: DayPlanBlock[];
  focus: string;
  disclaimer: string;
}

export function validatePlanDayResponse(raw: unknown): DayPlan {
  if (!isObject(raw) || !isObject(raw.plan)) invalidResponse("missing 'plan' object");
  const p = raw.plan as Record<string, unknown>;
  if (!DATE_REGEX.test(p.date as string)) invalidResponse("'date' must be YYYY-MM-DD");
  if (!Array.isArray(p.blocks)) invalidResponse("'blocks' must be an array");
  if ((p.blocks as unknown[]).length > 30) invalidResponse("too many plan blocks");

  const blocks: DayPlanBlock[] = (p.blocks as unknown[]).map((b, i) => {
    if (!isObject(b)) invalidResponse(`block[${i}] must be an object`);
    const block = b as Record<string, unknown>;
    return {
      startTime: validateOptionalTime(block.startTime, `blocks[${i}].startTime`),
      endTime: validateOptionalTime(block.endTime, `blocks[${i}].endTime`),
      taskRef: validateOptionalString(block.taskRef, `blocks[${i}].taskRef`, 10),
      title: validateString(block.title, `blocks[${i}].title`, 255),
      notes: validateOptionalString(block.notes, `blocks[${i}].notes`, 500)
    };
  });

  return {
    date: p.date as string,
    blocks,
    focus: validateString(p.focus, "focus", 500),
    disclaimer: validateString(p.disclaimer ?? "This is a suggestion.", "disclaimer", 300)
  };
}

// ---------------------------------------------------------------------------
// Break Down Task
// ---------------------------------------------------------------------------

export interface SubtaskSuggestion {
  title: string;
  position: number;
}

export function validateBreakDownResponse(raw: unknown): SubtaskSuggestion[] {
  if (!isObject(raw) || !Array.isArray(raw.subtasks)) invalidResponse("missing 'subtasks' array");
  if ((raw.subtasks as unknown[]).length > 20) invalidResponse("too many subtask suggestions (max 20)");
  return (raw.subtasks as unknown[]).map((s, i) => {
    if (!isObject(s)) invalidResponse(`subtask[${i}] must be an object`);
    const st = s as Record<string, unknown>;
    const pos = typeof st.position === "number" ? Math.max(0, Math.floor(st.position)) : i;
    return {
      title: validateString(st.title, `subtask[${i}].title`, 255),
      position: pos
    };
  });
}

// ---------------------------------------------------------------------------
// Project Plan
// ---------------------------------------------------------------------------

export interface ProjectTaskProposal {
  title: string;
  priority: "low" | "medium" | "high";
  dueDate: string | null;
  tags: string[];
  subtasks: string[];
}

export interface ProjectProposal {
  projectName: string;
  description: string;
  tasks: ProjectTaskProposal[];
}

export function validateProjectPlanResponse(raw: unknown): ProjectProposal {
  if (!isObject(raw) || !isObject(raw.proposal)) invalidResponse("missing 'proposal' object");
  const p = raw.proposal as Record<string, unknown>;
  if (!Array.isArray(p.tasks)) invalidResponse("'tasks' must be an array");
  if ((p.tasks as unknown[]).length > 20) invalidResponse("too many proposed tasks (max 20)");

  const tasks: ProjectTaskProposal[] = (p.tasks as unknown[]).map((t, i) => {
    if (!isObject(t)) invalidResponse(`task[${i}] must be an object`);
    const task = t as Record<string, unknown>;
    const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
    if (subtasks.length > 5) invalidResponse(`task[${i}] exceeds 5 subtasks`);
    return {
      title: validateString(task.title, `task[${i}].title`, 255),
      priority: validatePriority(task.priority ?? "medium", `task[${i}].priority`),
      dueDate: validateOptionalDate(task.dueDate, `task[${i}].dueDate`),
      tags: validateStringArray(task.tags ?? [], `task[${i}].tags`, 5, 50),
      subtasks: subtasks.map((s: unknown, si: number) =>
        validateString(s, `task[${i}].subtask[${si}]`, 255)
      )
    };
  });

  return {
    projectName: validateString(p.projectName, "projectName", 100),
    description: validateOptionalString(p.description, "description", 500) ?? "",
    tasks
  };
}

// ---------------------------------------------------------------------------
// Briefing
// ---------------------------------------------------------------------------

export interface BriefingResponse {
  greeting: string;
  summary: string;
}

export function validateBriefingResponse(raw: unknown): BriefingResponse {
  if (!isObject(raw)) invalidResponse("briefing response must be an object");
  const r = raw as Record<string, unknown>;
  return {
    greeting: validateString(r.greeting, "greeting", 100),
    summary: validateString(r.summary, "summary", 800)
  };
}

// ---------------------------------------------------------------------------
// Weekly Review
// ---------------------------------------------------------------------------

export interface WeeklyReviewResponse {
  narrative: string;
  nextWeekPreview: string;
}

export function validateWeeklyReviewResponse(raw: unknown): WeeklyReviewResponse {
  if (!isObject(raw)) invalidResponse("weekly review response must be an object");
  const r = raw as Record<string, unknown>;
  return {
    narrative: validateString(r.narrative, "narrative", 1000),
    nextWeekPreview: validateString(r.nextWeekPreview, "nextWeekPreview", 500)
  };
}

// ---------------------------------------------------------------------------
// Command Intent
// ---------------------------------------------------------------------------

export type IntentName = typeof ALLOWED_INTENTS[number];

export interface CommandIntent {
  intent: IntentName;
  confidence: number;
  params: {
    taskInput?: string | null;
    taskRef?: string | null;
    filters?: {
      projectName?: string | null;
      priority?: string | null;
      completed?: boolean | null;
    };
    changes?: {
      dueDate?: string | null;
      priority?: string | null;
      projectName?: string | null;
      completed?: boolean | null;
    };
  };
  requiresConfirmation: boolean;
  readOnly: boolean;
  naturalResponse?: string | null;
}

export function validateCommandIntentResponse(raw: unknown): CommandIntent {
  if (!isObject(raw)) invalidResponse("intent response must be an object");
  const r = raw as Record<string, unknown>;

  const intent = r.intent as string;
  if (!ALLOWED_INTENTS.includes(intent as any)) {
    // Unknown/unsupported intent — safe fallback
    return {
      intent: "UNKNOWN",
      confidence: 0,
      params: {},
      requiresConfirmation: false,
      readOnly: true,
      naturalResponse: null
    };
  }

  const confidence = typeof r.confidence === "number"
    ? Math.min(1, Math.max(0, r.confidence))
    : 0.5;

  const params = isObject(r.params) ? r.params as Record<string, unknown> : {};
  const filters = isObject(params.filters) ? params.filters as Record<string, unknown> : {};
  const changes = isObject(params.changes) ? params.changes as Record<string, unknown> : {};

  // Validate priority changes if present
  if (changes.priority !== undefined && changes.priority !== null) {
    if (!ALLOWED_PRIORITIES.includes(changes.priority as any)) {
      invalidResponse(`invalid priority in changes: '${changes.priority}'`);
    }
  }

  const readOnlyIntents: IntentName[] = ["SEARCH_TASKS", "SHOW_BRIEFING", "SHOW_WEEKLY_REVIEW", "PLAN_DAY", "UNKNOWN"];
  const isReadOnly = readOnlyIntents.includes(intent as IntentName);

  return {
    intent: intent as IntentName,
    confidence,
    params: {
      taskInput: validateOptionalString(params.taskInput, "taskInput", 300),
      taskRef: validateOptionalString(params.taskRef, "taskRef", 50),
      filters: {
        projectName: validateOptionalString(filters.projectName, "filters.projectName", 100),
        priority: filters.priority !== undefined
          ? (ALLOWED_PRIORITIES.includes(filters.priority as any) ? filters.priority as string : null)
          : null,
        completed: typeof filters.completed === "boolean" ? filters.completed : null
      },
      changes: {
        dueDate: validateOptionalDate(changes.dueDate, "changes.dueDate"),
        priority: changes.priority !== undefined
          ? (ALLOWED_PRIORITIES.includes(changes.priority as any) ? changes.priority as string : null)
          : null,
        projectName: validateOptionalString(changes.projectName, "changes.projectName", 100),
        completed: typeof changes.completed === "boolean" ? changes.completed : null
      }
    },
    requiresConfirmation: !isReadOnly,
    readOnly: isReadOnly,
    naturalResponse: validateOptionalString(r.naturalResponse, "naturalResponse", 300)
  };
}
