import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuthUser } from "../../server/auth.js";
import { getDbHttp, schema } from "../../server/db.js";
import { eq } from "drizzle-orm";
import { getAIConfig } from "../../server/ai/config.js";
import { getProvider } from "../../server/ai/provider.js";
import { planDaySchema } from "../../server/ai/schemas.js";
import { validatePlanDayResponse } from "../../server/ai/validator.js";
import { buildPlanDayContext, getTodayString } from "../../server/ai/context.js";
import { AIError } from "../../server/ai/errors.js";
import { createErrorResponse } from "../../server/errors.js";
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

    const db = getDbHttp();
    const body = req.body || {};

    // Determine user timezone
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

    const targetDate = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
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
    const resolvedBlocks = validatedPlan.blocks.map(block => ({
      ...block,
      taskId: block.taskRef ? (refMap.tasks[block.taskRef] ?? null) : null
    }));

    return res.status(200).json({
      data: {
        plan: {
          ...validatedPlan,
          blocks: resolvedBlocks
        }
      }
    });
  } catch (error) {
    const errorPayload = createErrorResponse(error);
    return res.status(errorPayload.statusCode).json(errorPayload.body);
  }
}
