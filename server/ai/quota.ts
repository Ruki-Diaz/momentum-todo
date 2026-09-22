/**
 * Momentum Intelligence — Database-Backed Daily AI Usage Limiting
 *
 * Enforces an application safety limit of 25 requests per UTC day per authenticated user.
 * Protects the shared Gemini Free Tier quota from abuse.
 *
 * ATOMIC IMPLEMENTATION:
 * Uses PostgreSQL atomic INSERT ... ON CONFLICT DO UPDATE ... WHERE request_count < limit
 * RETURNING request_count.
 * Row-level locks in PostgreSQL prevent concurrent requests from bypassing the 25-request limit.
 *
 * PRIVACY:
 * Stores only user_id, usage_date, request_count, and timestamps.
 * Zero prompts, task content, or AI responses are stored here.
 */

import { sql } from "drizzle-orm";
import { getDbHttp } from "../db.js";
import { getAIConfig } from "./config.js";
import { AIError } from "./errors.js";

export interface QuotaResult {
  allowed: boolean;
  remaining: number;
  resetDate: string;
  count: number;
}

/**
 * Atomically checks and increments the user's daily AI usage count.
 * Returns whether the request was allowed, the updated count, and remaining allowance.
 */
export async function consumeAIRequest(
  userId: string,
  options?: {
    targetDate?: string;
    customLimit?: number;
    tableName?: string;
  }
): Promise<QuotaResult> {
  const cfg = getAIConfig();
  const limit = options?.customLimit ?? cfg.dailyRequestLimit;
  // Enforce UTC day for deterministic daily quota reset
  const usageDate = options?.targetDate ?? new Date().toISOString().slice(0, 10);
  const table = options?.tableName ?? "ai_daily_usage";

  if (limit <= 0) {
    return { allowed: false, remaining: 0, resetDate: usageDate, count: 0 };
  }

  const db = getDbHttp();

  try {
    // Atomic UPSERT query with conditional increment.
    // - New row today: inserted with request_count = 1
    // - Existing row today: incremented by 1 ONLY IF current request_count < limit
    // - If current request_count >= limit: WHERE condition is false, no row is updated,
    //   and RETURNING produces 0 rows.
    const rawSql = `
      INSERT INTO ${table} (user_id, usage_date, request_count, created_at, updated_at)
      VALUES ($1::uuid, $2::date, 1, NOW(), NOW())
      ON CONFLICT (user_id, usage_date)
      DO UPDATE SET
        request_count = ${table}.request_count + 1,
        updated_at = NOW()
      WHERE ${table}.request_count < $3
      RETURNING request_count;
    `;

    const result = await db.execute<{ request_count: number }>(
      sql.raw(rawSql.replace("$1", `'${userId}'`).replace("$2", `'${usageDate}'`).replace("$3", String(limit)))
    );

    const rowsArray = Array.isArray(result) ? result : (result as any)?.rows ?? [];
    const updatedRow = rowsArray[0];

    if (!updatedRow) {
      // Limit reached or exceeded — no row was updated
      return {
        allowed: false,
        remaining: 0,
        resetDate: usageDate,
        count: limit
      };
    }

    const currentCount = Number(updatedRow.request_count);
    const remaining = Math.max(0, limit - currentCount);

    return {
      allowed: true,
      remaining,
      resetDate: usageDate,
      count: currentCount
    };
  } catch (err: any) {
    if (err instanceof AIError) {
      throw err;
    }
    // Fail-closed security rule: If quota infrastructure cannot be accessed or verified
    // for ANY reason (table missing, DB unavailable, query error),
    // NEVER allow the AI request. Fail closed with AI_UNAVAILABLE.
    console.error("[Momentum AI Quota] Quota infrastructure failure (failing closed):", err?.message ?? err);
    throw new AIError(
      503,
      "AI_UNAVAILABLE",
      "Momentum Intelligence is temporarily unavailable. Please try again shortly."
    );
  }
}

/**
 * Centrally enforces the daily AI quota.
 * Throws an AIError(429, "AI_RATE_LIMITED") if the limit is reached.
 */
export async function checkAndConsumeQuota(userId: string): Promise<QuotaResult> {
  const result = await consumeAIRequest(userId);

  if (!result.allowed) {
    throw new AIError(
      429,
      "AI_RATE_LIMITED",
      "You've reached today's Momentum Intelligence limit. AI will be available again tomorrow."
    );
  }

  return result;
}
