import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuthUser } from "../../server/auth.js";
import { getDbHttp, schema } from "../../server/db.js";
import { and, eq } from "drizzle-orm";
import { isValidUuid } from "../../server/validators.js";
import { getAIConfig } from "../../server/ai/config.js";
import { getProvider } from "../../server/ai/provider.js";
import { breakDownSchema } from "../../server/ai/schemas.js";
import { validateBreakDownResponse } from "../../server/ai/validator.js";
import { buildBreakDownContext } from "../../server/ai/context.js";
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

    return res.status(200).json({
      data: {
        subtasks
      }
    });
  } catch (error) {
    const errorPayload = createErrorResponse(error);
    return res.status(errorPayload.statusCode).json(errorPayload.body);
  }
}
