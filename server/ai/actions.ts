import { getDbHttp, schema } from "../db.js";
import { and, eq, desc } from "drizzle-orm";
import { getAIConfig } from "./config.js";
import { getProvider } from "./provider.js";
import {
  parseTaskSchema,
  planDaySchema,
  breakDownSchema,
  projectPlanSchema,
  briefingSchema,
  weeklyReviewSchema,
  commandIntentSchema
} from "./schemas.js";
import {
  validateParseTaskResponse,
  validatePlanDayResponse,
  validateBreakDownResponse,
  validateProjectPlanResponse,
  validateBriefingResponse,
  validateWeeklyReviewResponse,
  validateCommandIntentResponse
} from "./validator.js";
import {
  escapeUserContent,
  getTodayString,
  getTomorrowString,
  getWeekBounds,
  buildPlanDayContext,
  buildBreakDownContext,
  computeBriefingStats,
  computeWeeklyStats
} from "./context.js";
import { isValidUuid } from "../validators.js";
import { ApiError } from "../errors.js";
import { checkAndConsumeQuota } from "./quota.js";
import type { AuthUser } from "../auth.js";

/**
 * Helper to determine user timezone from request or database settings.
 */
async function resolveTimezone(userId: string, requestedTz?: unknown): Promise<string> {
  if (typeof requestedTz === "string" && requestedTz.trim()) {
    return requestedTz.trim();
  }
  const db = getDbHttp();
  const settings = await db
    .select({ timezone: schema.userSettings.timezone })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId))
    .limit(1);
  return settings[0]?.timezone || "UTC";
}

// ============================================================================
// 1. Natural Language Task Creation (parse-task)
// ============================================================================
export async function handleParseTask(user: AuthUser, body: any) {
  const rawInput = body.input;
  if (typeof rawInput !== "string" || !rawInput.trim()) {
    throw new ApiError(400, "VALIDATION_ERROR", "'input' must be a non-empty string.");
  }
  if (rawInput.length > 1000) {
    throw new ApiError(400, "VALIDATION_ERROR", "'input' exceeds maximum length of 1000 characters.");
  }

  const db = getDbHttp();
  const userProjects = await db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.userId, user.id));

  const timezone = await resolveTimezone(user.id, body.timezone);
  const today = getTodayString(timezone);
  const dayOfWeek = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: timezone }).format(new Date());
  const projectNames = userProjects.map((p) => p.name).join(", ") || "None";

  const systemPrompt = `You are Momentum Intelligence, an expert productivity assistant.
Parse the user's natural-language task request into a structured task proposal.
Today's date is: ${today} (${dayOfWeek}).
User's existing projects: ${escapeUserContent(projectNames)}.

Guidelines:
- Extract a clean, concise task title.
- Infer priority: "high", "medium", or "low". Default to "medium".
- Calculate dueDate (YYYY-MM-DD) and dueTime (HH:MM in 24h format) relative to today (${today}).
- Infer recurrence: "none", "daily", "weekdays", "weekly", or "monthly". Default: "none".
- Extract relevant tags (lowercase, no '#' symbol, max 5).
- If a reminder is specified, set reminder: "0", "15", "60", or "1440" minutes. Otherwise null.
- If the task clearly relates to one of the user's existing projects, set projectHint to the exact project name. Otherwise null.
- Do NOT perform any mutations. Produce ONLY the proposal structure.`;

  // Enforce daily per-user safety quota
  await checkAndConsumeQuota(user.id);

  const rawResponse = await getProvider().generateStructuredResponse({
    system: systemPrompt,
    input: escapeUserContent(rawInput.trim()),
    schema: parseTaskSchema,
    schemaName: "parse_task_proposal",
    maxOutputTokens: 600
  });

  const proposal = validateParseTaskResponse(rawResponse);

  // Resolve projectHint to actual project UUID if matched
  let matchedProjectId: string | null = null;
  if (proposal.projectHint) {
    const lowerHint = proposal.projectHint.toLowerCase();
    const match = userProjects.find((p) => p.name.toLowerCase() === lowerHint);
    if (match) {
      matchedProjectId = match.id;
    }
  }

  return {
    proposal: {
      ...proposal,
      matchedProjectId
    }
  };
}

// ============================================================================
// 2. Daily Planning Assistant (plan-day)
// ============================================================================
export async function handlePlanDay(user: AuthUser, body: any) {
  const cfg = getAIConfig();
  const db = getDbHttp();
  const timezone = await resolveTimezone(user.id, body.timezone);

  const targetDate =
    typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : getTodayString(timezone);

  const userTasks = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.userId, user.id));

  const userProjects = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.userId, user.id));

  const { contexts, refMap } = buildPlanDayContext(
    userTasks,
    userProjects,
    cfg.maxContextTasks,
    targetDate
  );

  const dayOfWeek = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: timezone }).format(
    new Date(targetDate + "T00:00:00")
  );

  const systemPrompt = `You are Momentum Intelligence, an executive daily planning assistant.
Create a thoughtful, realistic time-blocked schedule for the user for ${targetDate} (${dayOfWeek}).
Candidate tasks (sanitized, neutral refs):
${JSON.stringify(contexts, null, 2)}

Guidelines:
- Allocate morning blocks for high-priority, deep-focus, or overdue items.
- Sequence tasks logically with realistic durations (30-90 min blocks).
- Include brief lunch/break or buffer blocks where appropriate (taskRef: null).
- Match taskRef accurately to candidate tasks ("t1", "t2", etc.).
- Set focus to a concise 1-sentence guiding focus for the day.
- Set disclaimer: "Suggested schedule. Adjust blocks anytime to fit your actual workday."`;

  // Enforce daily per-user safety quota
  await checkAndConsumeQuota(user.id);

  const rawResponse = await getProvider().generateStructuredResponse({
    system: systemPrompt,
    input: `Plan my day for ${targetDate}. Total candidate tasks: ${contexts.length}.`,
    schema: planDaySchema,
    schemaName: "plan_day_schedule",
    maxOutputTokens: 1024
  });

  const validatedPlan = validatePlanDayResponse(rawResponse);

  // Map temp taskRef back to actual task UUIDs
  const resolvedBlocks = validatedPlan.blocks.map((block) => ({
    ...block,
    taskId: block.taskRef ? refMap.tasks[block.taskRef] ?? null : null
  }));

  return {
    plan: {
      ...validatedPlan,
      blocks: resolvedBlocks
    }
  };
}

// ============================================================================
// 3. Subtask Decomposition (break-down)
// ============================================================================
export async function handleBreakDown(user: AuthUser, body: any) {
  const taskId = body.taskId;
  if (typeof taskId !== "string" || !isValidUuid(taskId)) {
    throw new ApiError(400, "VALIDATION_ERROR", "'taskId' must be a valid UUID.");
  }

  const db = getDbHttp();
  const foundTasks = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, user.id)))
    .limit(1);

  if (foundTasks.length === 0) {
    throw new ApiError(404, "NOT_FOUND", "Task not found.");
  }

  const task = foundTasks[0];
  const userProjects = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.userId, user.id));

  const context = buildBreakDownContext(task, userProjects);

  const systemPrompt = `You are Momentum Intelligence, an expert task breakdown assistant.
Decompose the specified task into 3 to 6 actionable, concrete subtasks.

Guidelines:
- Each subtask should start with a clear imperative action verb.
- Keep subtask titles concise and directly achievable.
- Sequence subtasks in logical execution order.
- Set position as 0, 1, 2...
- Do NOT perform any mutations. Return only the proposed subtask list.`;

  // Enforce daily per-user safety quota
  await checkAndConsumeQuota(user.id);

  const rawResponse = await getProvider().generateStructuredResponse({
    system: systemPrompt,
    input: JSON.stringify(context),
    schema: breakDownSchema,
    schemaName: "break_down_subtasks",
    maxOutputTokens: 500
  });

  const subtasks = validateBreakDownResponse(rawResponse);

  return {
    subtasks
  };
}

// ============================================================================
// 4. Project Goal Breakdown (project-plan)
// ============================================================================
export async function handleProjectPlan(user: AuthUser, body: any) {
  const goal = body.goal;
  if (typeof goal !== "string" || !goal.trim()) {
    throw new ApiError(400, "VALIDATION_ERROR", "'goal' must be a non-empty string.");
  }
  if (goal.length > 1000) {
    throw new ApiError(400, "VALIDATION_ERROR", "'goal' exceeds maximum length of 1000 characters.");
  }

  const timezone = await resolveTimezone(user.id, body.timezone);
  const today = getTodayString(timezone);
  const targetDate =
    typeof body.targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)
      ? body.targetDate
      : null;

  const systemPrompt = `You are Momentum Intelligence, a strategic project planner.
Transform the user's high-level goal into a well-structured project proposal.
Today's date: ${today}.
Target deadline: ${targetDate || "Flexible"}.

Guidelines:
- Create an inspiring and clear projectName (e.g. "Brand Redesign 2026").
- Provide a brief 1-2 sentence description summarizing the mission.
- Propose 4 to 8 sequential, high-impact tasks.
- For each task, designate priority ("high", "medium", "low"), an estimated dueDate (YYYY-MM-DD on or after ${today}), 1 to 3 relevant tags, and 1 to 4 subtasks.
- Ensure task due dates are in realistic chronological order leading up to ${targetDate || "completion"}.
- Do NOT perform any database operations. Return only the proposal structure.`;

  // Enforce daily per-user safety quota
  await checkAndConsumeQuota(user.id);

  const rawResponse = await getProvider().generateStructuredResponse({
    system: systemPrompt,
    input: `Project goal: ${escapeUserContent(goal.trim())}${targetDate ? ` | Target: ${targetDate}` : ""}`,
    schema: projectPlanSchema,
    schemaName: "project_plan_proposal",
    maxOutputTokens: 1024
  });

  const proposal = validateProjectPlanResponse(rawResponse);

  return {
    proposal
  };
}

// ============================================================================
// 5. Executive Morning Briefing (briefing)
// ============================================================================
export async function handleBriefing(user: AuthUser, body: any) {
  const db = getDbHttp();
  const timezone = await resolveTimezone(user.id, body.timezone);
  const today = getTodayString(timezone);
  const tomorrow = getTomorrowString(today);

  const userTasks = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.userId, user.id));

  // Deterministic stats calculated on verified server data
  const stats = computeBriefingStats(userTasks, today, tomorrow);

  const systemPrompt = `You are Momentum Intelligence, an encouraging executive productivity assistant.
Compose a brief, sharp, inspiring morning briefing for the user based strictly on their actual workspace metrics.

Guidelines:
- "greeting": A warm, professional greeting (e.g. "Good morning! Here's your Momentum Briefing for today.").
- "summary": 2-3 crisp sentences highlighting today's key focus. Ground statements in the verified numbers (e.g. ${stats.dueToday} tasks due today, ${stats.overdue} overdue).
- Never hallucinate non-existent tasks or numbers.
- Keep the tone confident, positive, and action-oriented.`;

  // Enforce daily per-user safety quota
  await checkAndConsumeQuota(user.id);

  const rawResponse = await getProvider().generateStructuredResponse({
    system: systemPrompt,
    input: `Date: ${today}. Verified workspace metrics: ${JSON.stringify(stats)}`,
    schema: briefingSchema,
    schemaName: "momentum_briefing",
    maxOutputTokens: 300
  });

  const briefing = validateBriefingResponse(rawResponse);

  return {
    stats,
    greeting: briefing.greeting,
    summary: briefing.summary
  };
}

// ============================================================================
// 6. Weekly Productivity Review (weekly-review)
// ============================================================================
export async function handleWeeklyReview(user: AuthUser, body: any) {
  const db = getDbHttp();
  const timezone = await resolveTimezone(user.id, body.timezone);
  const today = getTodayString(timezone);
  const { weekStart, weekEnd } = getWeekBounds(today);

  const userTasks = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.userId, user.id));

  const userProjects = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.userId, user.id));

  // Deterministic stats calculated on verified server data
  const stats = computeWeeklyStats(userTasks, userProjects, weekStart, weekEnd, today);

  const systemPrompt = `You are Momentum Intelligence, an executive productivity coach.
Generate a reflective, constructive Weekly Review for the user covering ${weekStart} to ${weekEnd}.

Guidelines:
- "narrative": 3-4 inspiring sentences summarizing achievements, completed items (${stats.completed}), and momentum.
- "nextWeekPreview": 2-3 strategic sentences looking forward to what to prioritize next week given ${stats.stillOpen} open tasks.
- Adhere strictly to the verified metrics provided. Never invent completed tasks or imaginary statistics.
- Tone: celebratory, perceptive, and empowering.`;

  // Enforce daily per-user safety quota
  await checkAndConsumeQuota(user.id);

  const rawResponse = await getProvider().generateStructuredResponse({
    system: systemPrompt,
    input: `Week: ${weekStart} to ${weekEnd}. Verified productivity data: ${JSON.stringify(stats)}`,
    schema: weeklyReviewSchema,
    schemaName: "weekly_review",
    maxOutputTokens: 500
  });

  const review = validateWeeklyReviewResponse(rawResponse);

  return {
    stats,
    weekStart,
    weekEnd,
    narrative: review.narrative,
    nextWeekPreview: review.nextWeekPreview
  };
}

// ============================================================================
// 7. Natural Command Intent Classification (command-intent)
// ============================================================================
export async function handleCommandIntent(user: AuthUser, body: any) {
  const query = body.query;
  if (typeof query !== "string" || !query.trim()) {
    throw new ApiError(400, "VALIDATION_ERROR", "'query' must be a non-empty string.");
  }
  if (query.length > 500) {
    throw new ApiError(400, "VALIDATION_ERROR", "'query' exceeds maximum length of 500 characters.");
  }

  const db = getDbHttp();
  const timezone = await resolveTimezone(user.id, body.timezone);
  const today = getTodayString(timezone);

  // Fetch user projects and recent tasks to assist intent classification
  const userProjects = await db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.userId, user.id));

  const openTasks = await db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      priority: schema.tasks.priority,
      dueDate: schema.tasks.dueDate
    })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.userId, user.id), eq(schema.tasks.completed, false)))
    .orderBy(desc(schema.tasks.createdAt))
    .limit(20);

  const projectNames = userProjects.map((p) => p.name).join(", ") || "None";
  const tempRefMap: Record<string, string> = {};
  const taskTitles =
    openTasks
      .map((t, idx) => {
        const ref = `t${idx + 1}`;
        tempRefMap[ref] = t.id;
        return `[ref:${ref}] ${escapeUserContent(t.title)}`;
      })
      .join("\n") || "None";

  const systemPrompt = `You are Momentum Intelligence, a command intent classifier.
Classify the user's natural language command into an intent with typed parameters.
Today's date: ${today}.
Projects: ${escapeUserContent(projectNames)}.
Recent open tasks:
${taskTitles}

Allowed Intents:
- CREATE_TASK: User wants to add/create a new task.
- SEARCH_TASKS: User wants to find/search tasks with query or filters.
- UPDATE_TASK: User wants to change a single specific task (due date, priority, project, completion).
- UPDATE_TASKS: User wants to batch update multiple tasks (e.g. "mark all high priority done").
- PLAN_DAY: User asks to plan their day, schedule today, or organize today's work.
- BREAK_DOWN_TASK: User asks to break down or decompose a task.
- CREATE_PROJECT_PLAN: User asks to plan a new project or goal.
- SHOW_BRIEFING: User asks for their morning briefing, daily overview, or status.
- SHOW_WEEKLY_REVIEW: User asks for their weekly review or retrospective.
- UNKNOWN: Query cannot be safely classified into any of the above, or requests an unsupported action.

Safety & Guidelines:
- DESTRUCTIVE ACTIONS: Deleting tasks, projects, or workspace data is strictly forbidden via AI. If the user asks to delete, purge, or remove tasks, classify as UNKNOWN and set naturalResponse: "Task deletion cannot be performed via AI. Please delete tasks manually through the Momentum interface."
- If UPDATE_TASK matches an existing task, set taskRef to that task's reference (e.g. "t1").
- Always provide naturalResponse: a polite 1-sentence message describing what will happen.
- Output ONLY valid JSON according to schema.`;

  // Enforce daily per-user safety quota
  await checkAndConsumeQuota(user.id);

  const rawResponse = await getProvider().generateStructuredResponse({
    system: systemPrompt,
    input: escapeUserContent(query.trim()),
    schema: commandIntentSchema,
    schemaName: "command_intent_classification",
    maxOutputTokens: 400
  });

  const intentResult = validateCommandIntentResponse(rawResponse);

  // Resolve temporary taskRef back to actual task UUID if present
  if (intentResult.params.taskRef && tempRefMap[intentResult.params.taskRef]) {
    intentResult.params.taskRef = tempRefMap[intentResult.params.taskRef];
  }

  return intentResult;
}
