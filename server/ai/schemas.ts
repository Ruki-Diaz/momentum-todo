/**
 * Momentum Intelligence — JSON Schemas for Strict Structured Outputs
 *
 * Strict mode requires:
 * - type: "object" at top level
 * - all fields in "properties" must be listed in "required"
 * - additionalProperties: false on all objects
 * - nullable types specified as ["string", "null"], etc.
 */

export const parseTaskSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    proposal: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        dueDate: { type: ["string", "null"] },
        dueTime: { type: ["string", "null"] },
        projectHint: { type: ["string", "null"] },
        tags: { type: "array", items: { type: "string" } },
        reminder: { type: ["string", "null"] },
        recurrence: { type: "string", enum: ["none", "daily", "weekdays", "weekly", "monthly"] }
      },
      required: ["title", "description", "priority", "dueDate", "dueTime", "projectHint", "tags", "reminder", "recurrence"],
      additionalProperties: false
    }
  },
  required: ["proposal"],
  additionalProperties: false
};

export const planDaySchema: Record<string, unknown> = {
  type: "object",
  properties: {
    plan: {
      type: "object",
      properties: {
        date: { type: "string" },
        focus: { type: "string" },
        disclaimer: { type: "string" },
        blocks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              startTime: { type: ["string", "null"] },
              endTime: { type: ["string", "null"] },
              taskRef: { type: ["string", "null"] },
              title: { type: "string" },
              notes: { type: ["string", "null"] }
            },
            required: ["startTime", "endTime", "taskRef", "title", "notes"],
            additionalProperties: false
          }
        }
      },
      required: ["date", "focus", "disclaimer", "blocks"],
      additionalProperties: false
    }
  },
  required: ["plan"],
  additionalProperties: false
};

export const breakDownSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    subtasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          position: { type: "integer" }
        },
        required: ["title", "position"],
        additionalProperties: false
      }
    }
  },
  required: ["subtasks"],
  additionalProperties: false
};

export const projectPlanSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    proposal: {
      type: "object",
      properties: {
        projectName: { type: "string" },
        description: { type: "string" },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              priority: { type: "string", enum: ["low", "medium", "high"] },
              dueDate: { type: ["string", "null"] },
              tags: { type: "array", items: { type: "string" } },
              subtasks: { type: "array", items: { type: "string" } }
            },
            required: ["title", "priority", "dueDate", "tags", "subtasks"],
            additionalProperties: false
          }
        }
      },
      required: ["projectName", "description", "tasks"],
      additionalProperties: false
    }
  },
  required: ["proposal"],
  additionalProperties: false
};

export const briefingSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    greeting: { type: "string" },
    summary: { type: "string" }
  },
  required: ["greeting", "summary"],
  additionalProperties: false
};

export const weeklyReviewSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    narrative: { type: "string" },
    nextWeekPreview: { type: "string" }
  },
  required: ["narrative", "nextWeekPreview"],
  additionalProperties: false
};

export const commandIntentSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: [
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
      ]
    },
    confidence: { type: "number" },
    params: {
      type: "object",
      properties: {
        taskInput: { type: ["string", "null"] },
        taskRef: { type: ["string", "null"] },
        filters: {
          type: "object",
          properties: {
            projectName: { type: ["string", "null"] },
            priority: { type: ["string", "null"] },
            completed: { type: ["boolean", "null"] }
          },
          required: ["projectName", "priority", "completed"],
          additionalProperties: false
        },
        changes: {
          type: "object",
          properties: {
            dueDate: { type: ["string", "null"] },
            priority: { type: ["string", "null"] },
            projectName: { type: ["string", "null"] },
            completed: { type: ["boolean", "null"] }
          },
          required: ["dueDate", "priority", "projectName", "completed"],
          additionalProperties: false
        }
      },
      required: ["taskInput", "taskRef", "filters", "changes"],
      additionalProperties: false
    },
    naturalResponse: { type: ["string", "null"] }
  },
  required: ["intent", "confidence", "params", "naturalResponse"],
  additionalProperties: false
};
