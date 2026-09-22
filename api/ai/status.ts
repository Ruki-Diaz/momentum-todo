import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAIConfig } from "../../server/ai/config.js";
import { createErrorResponse } from "../../server/errors.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: `Method ${req.method} is not allowed on this endpoint.`
        }
      });
    }

    const cfg = getAIConfig();
    return res.status(200).json({
      data: {
        enabled: cfg.enabled
      },
      enabled: cfg.enabled
    });
  } catch (error) {
    const errorPayload = createErrorResponse(error);
    return res.status(errorPayload.statusCode).json(errorPayload.body);
  }
}
