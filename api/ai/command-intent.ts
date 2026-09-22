import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuthUser } from "../../server/auth.js";
import { getDbHttp, schema } from "../../server/db.js";
import { and, eq, desc } from "drizzle-orm";
import { getAIConfig } from "../../server/ai/config.js";
import { getProvider } from "../../server/ai/provider.js";
import { commandIntentSchema } from "../../server/ai/schemas.js";
import { validateCommandIntentResponse } from "../../server/ai/validator.js";
import { escapeUserContent, getTodayString } from "../../server/ai/context.js";
import { AIError } from "../../server/ai/errors.js";
import { ApiError, createErrorResponse } from "../../server/errors.js";
import { checkAndConsumeQuota } from "../../server/ai/quota.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: `Method ${req.method} is not allowed on this endpoint.`
        }
      });
    }

    const user = await requireAuthUser(req);
    const cfg = getAIConfig();
    if (!cfg.enabled) {
      throw new AIError(503, "AI_DISABLED", "Momentum Intelligence is currently disabled.");
    }

    const body = req.body || {};
    const query = body.query;
    if (typeof query !== "string" || !query.trim()) {
      throw new ApiError(400, "VALIDATION_ERROR", "'query' must be a non-empty string.");
    }
    if (query.length > 500) {
      throw new ApiError(400, "VALIDATION_ERROR", "'query' exceeds maximum length of 500 characters.");
    }

    const db = getDbHttp();
    let timezone = "UTC";
    if (typeof body.timezone === "string" && body.timezone.trim()) {
      timezone = body.timezone.trim();
    } else {
      const settings = await db
        .select({ timezone: schema.userSettings.timezone })
        .from(schema.userSettings)
        .where(eq(schema.userSettings.userId, user.id))
        .limit(1);
      if (settings[0]?.timezone) {
        timezone = settings[0].timezone;
      }
    }

    const today = getTodayString(timezone);

    // Fetch user projects and recent tasks to assist intent classification
    const userProjects = await db
      .select({ id: schema.projects.id, name: schema.projects.name })
      .from(schema.projects)
      .where(eq(schema.projects.userId, user.id));

    const openTasks = await db
      .select({ id: schema.tasks.id, title: schema.tasks.title, priority: schema.tasks.priority, dueDate: schema.tasks.dueDate })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.userId, user.id), eq(schema.tasks.completed, false)))
      .orderBy(desc(schema.tasks.createdAt))
      .limit(20);

    const projectNames = userProjects.map(p => p.name).join(", ") || "None";
    const tempRefMap: Record<string, string> = {};
    const taskTitles = openTasks.map((t, idx) => {
      const ref = `t${idx + 1}`;
      tempRefMap[ref] = t.id;
      return `[ref:${ref}] ${escapeUserContent(t.title)}`;
    }).join("\n") || "None";

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

    return res.status(200).json({
      data: intentResult
    });
  } catch (error) {
    const errorPayload = createErrorResponse(error);
    return res.status(errorPayload.statusCode).json(errorPayload.body);
  }
}
