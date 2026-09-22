import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuthUser } from "../../server/auth.js";
import { getDbHttp, schema } from "../../server/db.js";
import { eq } from "drizzle-orm";
import { getAIConfig } from "../../server/ai/config.js";
import { getProvider } from "../../server/ai/provider.js";
import { briefingSchema } from "../../server/ai/schemas.js";
import { validateBriefingResponse } from "../../server/ai/validator.js";
import { computeBriefingStats, getTodayString, getTomorrowString } from "../../server/ai/context.js";
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

    return res.status(200).json({
      data: {
        stats,
        greeting: briefing.greeting,
        summary: briefing.summary
      }
    });
  } catch (error) {
    const errorPayload = createErrorResponse(error);
    return res.status(errorPayload.statusCode).json(errorPayload.body);
  }
}
