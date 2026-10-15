import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuthUser } from "../../server/auth.js";
import { getDbHttp, schema } from "../../server/db.js";
import { eq, sql } from "drizzle-orm";
import { validateSettingsInput } from "../../server/validators.js";
import { serializeUserSettings } from "../../server/serializers.js";
import { ApiError, createErrorResponse } from "../../server/errors.js";
import { isAuthorizedCron, runDailyDigest, unsubscribeUser, verifyUnsubscribeToken } from "../../server/digest.js";

function appUrlFrom(req: VercelRequest): string {
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "momentumtodo.vercel.app";
  const proto = (req.headers["x-forwarded-proto"] as string) || (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function unsubscribePage(res: VercelResponse, status: number, heading: string, body: string) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(status).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Momentum</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4efe7;color:#22170d;">
<main style="max-width:480px;margin:15vh auto;padding:24px;text-align:center;">
<h1 style="font-family:Georgia,serif;font-weight:normal;">${heading}</h1><p style="color:#524335;line-height:1.5;">${body}</p>
<p><a href="/" style="color:#a54724;">Open Momentum</a></p></main></body></html>`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = typeof req.query.action === "string" ? req.query.action : "";

  // Daily "Your day" email, called once a day by Vercel Cron (rewrite: /api/cron/daily-email).
  if (action === "daily-email") {
    if (!isAuthorizedCron(req.headers.authorization, process.env.CRON_SECRET)) {
      return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Not allowed." } });
    }
    try {
      const summary = await runDailyDigest({ appUrl: appUrlFrom(req) });
      return res.status(200).json({ data: summary });
    } catch (error) {
      const errorPayload = createErrorResponse(error);
      return res.status(errorPayload.statusCode).json(errorPayload.body);
    }
  }

  // One-click unsubscribe from the email footer; works without logging in
  // (rewrite: /api/email/unsubscribe). POST supports mail apps' one-click button.
  if (action === "unsubscribe") {
    const userId = verifyUnsubscribeToken(req.query.token, process.env.CRON_SECRET);
    if (!userId) {
      return unsubscribePage(res, 400, "That link didn't work", "It may be incomplete. You can turn the morning email off any time in Momentum under Reminders &amp; daily email.");
    }
    try {
      await unsubscribeUser(userId);
      return unsubscribePage(res, 200, "You're unsubscribed", "You won't get the morning email any more. You can turn it back on in Momentum under Reminders &amp; daily email.");
    } catch (error) {
      console.error("[unsubscribe] failed:", error);
      return unsubscribePage(res, 500, "Something went wrong", "Please try the link again in a minute.");
    }
  }

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

      const updatePayload: any = {
        theme: input.theme !== undefined ? input.theme : current.theme,
        sortPreference: input.sortPreference !== undefined ? input.sortPreference : current.sortPreference,
        version: current.version + 1,
        updatedAt: new Date()
      };

      if (input.onboardingCompleted !== undefined) {
        updatePayload.onboardingCompleted = input.onboardingCompleted;
      }
      if (input.timezone !== undefined) {
        updatePayload.timezone = input.timezone;
      }
      if (input.dailyEmail !== undefined) {
        updatePayload.dailyEmail = input.dailyEmail;
      }
      if (input.dailyEmailHour !== undefined) {
        updatePayload.dailyEmailHour = input.dailyEmailHour;
      }

      const updated = await db
        .update(schema.userSettings)
        .set(updatePayload)
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
