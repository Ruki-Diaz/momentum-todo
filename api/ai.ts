import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuthUser } from "../server/auth.js";
import { getAIConfig } from "../server/ai/config.js";
import { AIError } from "../server/ai/errors.js";
import { ApiError, createErrorResponse } from "../server/errors.js";
import {
  handleParseTask,
  handlePlanDay,
  handleBreakDown,
  handleProjectPlan,
  handleBriefing,
  handleWeeklyReview,
  handleCommandIntent
} from "../server/ai/actions.js";

const SUPPORTED_ACTIONS = new Set([
  "parse-task",
  "plan-day",
  "break-down",
  "project-plan",
  "briefing",
  "weekly-review",
  "command-intent"
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const cfg = getAIConfig();

    // 1. Status Check (GET /api/ai or ?action=status)
    if (req.method === "GET" || req.query.action === "status") {
      return res.status(200).json({
        data: {
          enabled: cfg.enabled
        },
        enabled: cfg.enabled
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: `Method ${req.method} is not allowed on this endpoint.`
        }
      });
    }

    const body = req.body || {};
    const action = body.action;

    // Status check via POST
    if (action === "status") {
      return res.status(200).json({
        data: {
          enabled: cfg.enabled
        },
        enabled: cfg.enabled
      });
    }

    // 2. Validate Action (fail early before auth or quota)
    if (typeof action !== "string" || !SUPPORTED_ACTIONS.has(action)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `Unsupported or missing AI action '${action}'. Supported actions: ${Array.from(SUPPORTED_ACTIONS).join(", ")}`
      );
    }

    // 3. Require Authenticated Cloud User
    const user = await requireAuthUser(req);

    // 4. Require AI Feature Enabled
    if (!cfg.enabled) {
      throw new AIError(503, "AI_DISABLED", "Momentum Intelligence is currently disabled.");
    }

    // 5. Dispatch to Action Logic
    let result: any;
    switch (action) {
      case "parse-task":
        result = await handleParseTask(user, body);
        break;
      case "plan-day":
        result = await handlePlanDay(user, body);
        break;
      case "break-down":
        result = await handleBreakDown(user, body);
        break;
      case "project-plan":
        result = await handleProjectPlan(user, body);
        break;
      case "briefing":
        result = await handleBriefing(user, body);
        break;
      case "weekly-review":
        result = await handleWeeklyReview(user, body);
        break;
      case "command-intent":
        result = await handleCommandIntent(user, body);
        break;
      default:
        throw new ApiError(400, "VALIDATION_ERROR", `Unsupported AI action '${action}'`);
    }

    return res.status(200).json({ data: result });
  } catch (error) {
    const errorPayload = createErrorResponse(error);
    return res.status(errorPayload.statusCode).json(errorPayload.body);
  }
}
