import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuthUser } from "../../server/auth.js";
import { getDbHttp, schema } from "../../server/db.js";
import { eq } from "drizzle-orm";
import { getAIConfig } from "../../server/ai/config.js";
import { getProvider } from "../../server/ai/provider.js";
import { projectPlanSchema } from "../../server/ai/schemas.js";
import { validateProjectPlanResponse } from "../../server/ai/validator.js";
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
    const goal = body.goal;
    if (typeof goal !== "string" || !goal.trim()) {
      throw new ApiError(400, "VALIDATION_ERROR", "'goal' must be a non-empty string.");
    }
    if (goal.length > 1000) {
      throw new ApiError(400, "VALIDATION_ERROR", "'goal' exceeds maximum length of 1000 characters.");
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
    const targetDate = typeof body.targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)
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

    return res.status(200).json({
      data: {
        proposal
      }
    });
  } catch (error) {
    const errorPayload = createErrorResponse(error);
    return res.status(errorPayload.statusCode).json(errorPayload.body);
  }
}
