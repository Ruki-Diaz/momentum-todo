import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDbHttp } from "../server/db.js";
import { sql } from "drizzle-orm";
import { createErrorResponse } from "../server/errors.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: `Method ${req.method} is not allowed on this endpoint.`
      }
    });
  }

  const startTime = performance.now();

  try {
    let dbStatus = "unconfigured";
    let dbLatencyMs: number | null = null;

    if (process.env.DATABASE_URL) {
      try {
        const db = getDbHttp();
        const dbStart = performance.now();
        await db.execute(sql`SELECT 1`);
        dbLatencyMs = Math.round(performance.now() - dbStart);
        dbStatus = "connected";
      } catch (dbErr) {
        dbStatus = "error";
        console.warn("Health check DB query warning:", dbErr instanceof Error ? dbErr.message : dbErr);
      }
    }

    const totalLatencyMs = Math.round(performance.now() - startTime);

    return res.status(200).json({
      status: "ok",
      app: "Momentum",
      version: "2.0.0",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      services: {
        database: {
          provider: "Neon PostgreSQL",
          status: dbStatus,
          latencyMs: dbLatencyMs
        }
      },
      latencyMs: totalLatencyMs
    });
  } catch (error) {
    const errorPayload = createErrorResponse(error);
    return res.status(errorPayload.statusCode).json(errorPayload.body);
  }
}
