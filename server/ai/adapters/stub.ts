/**
 * Momentum Intelligence — Stub AI Adapter
 *
 * FOR DEVELOPMENT AND TESTING ONLY.
 *
 * Returns deterministic mock responses without any network calls.
 * Active when AI_ENABLED=false OR AI_PROVIDER=stub.
 *
 * PRODUCTION BEHAVIOR:
 * - The stub adapter is never used when AI_ENABLED=true and AI_PROVIDER=openai.
 * - If AI_ENABLED=false, the /api/ai/status endpoint returns { enabled: false }.
 * - The frontend hides AI features and does not call stub endpoints.
 * - Mock results are NEVER presented as real AI intelligence in production.
 */

import type { AIProvider, GenerateParams } from "../provider.js";

const STUB_RESPONSES: Record<string, unknown> = {
  parse_task_proposal: {
    proposal: {
      title: "Review project proposal",
      description: "",
      priority: "medium",
      dueDate: null,
      dueTime: null,
      projectHint: null,
      tags: [],
      reminder: null,
      recurrence: "none"
    }
  },
  day_plan: {
    plan: {
      date: new Date().toISOString().slice(0, 10),
      blocks: [
        { startTime: "09:00", endTime: "10:30", taskRef: "t1", title: "Focus block", notes: "Your highest priority task" },
        { startTime: "10:30", endTime: "10:45", taskRef: null, title: "Break", notes: null },
        { startTime: "10:45", endTime: "12:00", taskRef: null, title: "Remaining tasks", notes: null }
      ],
      focus: "Start with your most important task while your energy is highest.",
      disclaimer: "This is a suggestion based on your task priorities and due dates."
    }
  },
  break_down: {
    subtasks: [
      { title: "Research and gather requirements", position: 0 },
      { title: "Create initial draft", position: 1 },
      { title: "Review and revise", position: 2 },
      { title: "Final check and submit", position: 3 }
    ]
  },
  project_plan: {
    proposal: {
      projectName: "New Project",
      description: "A structured plan to achieve your goal.",
      tasks: [
        { title: "Define scope and objectives", priority: "high", dueDate: null, tags: [], subtasks: [] },
        { title: "Research and planning phase", priority: "medium", dueDate: null, tags: [], subtasks: [] },
        { title: "Execution phase", priority: "medium", dueDate: null, tags: [], subtasks: [] },
        { title: "Review and iterate", priority: "medium", dueDate: null, tags: [], subtasks: [] },
        { title: "Final delivery", priority: "high", dueDate: null, tags: [], subtasks: [] }
      ]
    }
  },
  briefing: {
    greeting: "Good morning.",
    summary: "You have tasks due today. Your most important item is ready for your attention. Take it one step at a time."
  },
  weekly_review: {
    narrative: "This week you maintained steady progress across your projects. Your completion rate was strong.",
    nextWeekPreview: "Next week, focus on closing out open tasks before taking on new ones."
  },
  command_intent: {
    intent: "UNKNOWN",
    confidence: 0.5,
    params: {},
    requiresConfirmation: false,
    readOnly: true,
    naturalResponse: "Momentum Intelligence is running in development mode."
  }
};

class StubProvider implements AIProvider {
  async generateStructuredResponse(params: GenerateParams): Promise<unknown> {
    // Identify which stub response to return based on schema name
    const name = params.schemaName.toLowerCase();

    if (name.includes("parse") || name.includes("task_proposal")) {
      return STUB_RESPONSES.parse_task_proposal;
    }
    if (name.includes("project")) {
      return STUB_RESPONSES.project_plan;
    }
    if (name.includes("break") || name.includes("subtask")) {
      return STUB_RESPONSES.break_down;
    }
    if (name.includes("day_plan") || name.includes("plan_day") || name === "day_plan_proposal" || name === "plandayresult" || name.includes("plan")) {
      return STUB_RESPONSES.day_plan;
    }
    if (name.includes("briefing")) {
      return STUB_RESPONSES.briefing;
    }
    if (name.includes("weekly") || name.includes("review")) {
      return STUB_RESPONSES.weekly_review;
    }
    if (name.includes("intent") || name.includes("command")) {
      return STUB_RESPONSES.command_intent;
    }

    // Generic fallback — return an empty safe structure
    return {};
  }
}

export const stubProvider: AIProvider = new StubProvider();
