import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuthUser } from "../../server/auth.js";
import { getDbHttp, schema } from "../../server/db.js";
import { eq } from "drizzle-orm";
import { getAIConfig } from "../../server/ai/config.js";
import { getProvider } from "../../server/ai/provider.js";
import { weeklyReviewSchema } from "../../server/ai/schemas.js";
import { validateWeeklyReviewResponse } from "../../server/ai/validator.js";
import { computeWeeklyStats, getTodayString, getWeekBounds } from "../../server/ai/context.js";
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

    return res.status(200).json({
      data: {
        stats,
        weekStart,
        weekEnd,
        narrative: review.narrative,
        nextWeekPreview: review.nextWeekPreview
      }
    });
  } catch (error) {
    const errorPayload = createErrorResponse(error);
    return res.status(errorPayload.statusCode).json(errorPayload.body);
  }
}
