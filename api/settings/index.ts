import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuthUser } from "../../server/auth.js";
import { getDbHttp, schema } from "../../server/db.js";
import { eq, sql } from "drizzle-orm";
import { validateSettingsInput } from "../../server/validators.js";
import { serializeUserSettings } from "../../server/serializers.js";
import { ApiError, createErrorResponse } from "../../server/errors.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuthUser(req);
    const db = getDbHttp();

    if (req.method === "GET") {
      // Concurrency-safe atomic upsert ensuring lazy creation never fails on duplicate calls
      const result = await db
        .insert(schema.userSettings)
        .values({
          userId: user.id,
          theme: "dark",
          sortPreference: "smart",
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: schema.userSettings.userId,
          set: {
            updatedAt: sql`${schema.userSettings.updatedAt}`
          }
        })
        .returning();

      return res.status(200).json({
        data: serializeUserSettings(result[0])
      });
    }

    if (req.method === "PATCH") {
      const input = validateSettingsInput(req.body, true);

      // Lazily ensure settings exist first
      const existing = await db
        .insert(schema.userSettings)
        .values({
          userId: user.id,
          theme: "dark",
          sortPreference: "smart",
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: schema.userSettings.userId,
          set: {
            updatedAt: sql`${schema.userSettings.updatedAt}`
          }
        })
        .returning();

      const current = existing[0];
      if (current.version !== input.version) {
        throw new ApiError(409, "STALE_VERSION", "Your settings were updated on another device.");
      }

      const updated = await db
        .update(schema.userSettings)
        .set({
          theme: input.theme !== undefined ? input.theme : current.theme,
          sortPreference: input.sortPreference !== undefined ? input.sortPreference : current.sortPreference,
          version: current.version + 1,
          updatedAt: new Date()
        })
        .where(eq(schema.userSettings.userId, user.id))
        .returning();

      return res.status(200).json({
        data: serializeUserSettings(updated[0])
      });
    }

    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: `Method ${req.method} is not allowed on this endpoint.`
      }
    });
  } catch (error) {
    const errorPayload = createErrorResponse(error);
    return res.status(errorPayload.statusCode).json(errorPayload.body);
  }
}
