import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuthUser } from "../../server/auth.js";
import { getDbHttp, schema } from "../../server/db.js";
import { eq } from "drizzle-orm";
import { getAIConfig } from "../../server/ai/config.js";
import { getProvider } from "../../server/ai/provider.js";
import { parseTaskSchema } from "../../server/ai/schemas.js";
import { validateParseTaskResponse } from "../../server/ai/validator.js";
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

    const today = getTodayString(timezone);
    const dayOfWeek = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: timezone }).format(new Date());
    const projectNames = userProjects.map(p => p.name).join(", ") || "None";

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
      const match = userProjects.find(p => p.name.toLowerCase() === lowerHint);
      if (match) {
        matchedProjectId = match.id;
      }
    }

    return res.status(200).json({
      data: {
        proposal: {
          ...proposal,
          matchedProjectId
        }
      }
    });
  } catch (error) {
    const errorPayload = createErrorResponse(error);
    return res.status(errorPayload.statusCode).json(errorPayload.body);
  }
}
