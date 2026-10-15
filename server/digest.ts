/**
 * Momentum — "Your day" morning email.
 *
 * Pure helpers (configuration check, cron auth, unsubscribe tokens, email builder) plus the
 * daily job that sends through Brevo's transactional email HTTP API.
 *
 * Scheduling: Vercel's free Hobby plan allows one cron run per day, so everyone who opted in
 * gets the email from that single run (see "crons" in vercel.json). Each person's own
 * dailyEmailHour is stored now, but honouring per-user send hours needs a more frequent
 * scheduler later (an hourly cron on a paid plan, or an external scheduler).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { getDbHttp, schema } from "./db.js";

type Env = Record<string, string | undefined>;

// -----------------------------------------------------------------------------
// Configuration & auth
// -----------------------------------------------------------------------------

/** The feature is on only when the sender, API key and signing secret are all set. */
export function isDigestConfigured(env: Env = process.env): boolean {
  return Boolean(env.BREVO_API_KEY && env.DIGEST_FROM_EMAIL && env.CRON_SECRET);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. */
export function isAuthorizedCron(authHeader: string | string[] | undefined, secret: string | undefined): boolean {
  if (!secret || typeof authHeader !== "string") return false;
  return safeEqual(authHeader, `Bearer ${secret}`);
}

// -----------------------------------------------------------------------------
// One-click unsubscribe tokens (work without logging in)
// -----------------------------------------------------------------------------

function unsubscribeSignature(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(`daily-email-unsubscribe:${userId}`).digest("base64url");
}

export function signUnsubscribeToken(userId: string, secret: string): string {
  return `${userId}.${unsubscribeSignature(userId, secret)}`;
}

/** Returns the user id when the token is genuine, otherwise null. */
export function verifyUnsubscribeToken(token: unknown, secret: string | undefined): string | null {
  if (!secret || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  return safeEqual(sig, unsubscribeSignature(userId, secret)) ? userId : null;
}

// -----------------------------------------------------------------------------
// Dates in the user's own timezone
// -----------------------------------------------------------------------------

export function localDateString(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function addDaysToDateString(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

// -----------------------------------------------------------------------------
// Email builder
// -----------------------------------------------------------------------------

export interface DigestTask {
  title: string;
  dueDate: string; // YYYY-MM-DD
  dueTime: string | null; // HH:MM or HH:MM:SS
  priority: string;
}

export interface DigestInput {
  firstName: string | null;
  today: string; // YYYY-MM-DD in the user's timezone
  tasks: DigestTask[]; // open tasks with a due date
  appUrl: string;
  unsubscribeUrl: string;
}

export interface DigestEmail {
  subject: string;
  html: string;
  text: string;
  counts: { today: number; overdue: number; upcoming: number };
}

const MAX_PER_SECTION = 5;

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTime(t: string | null): string {
  if (!t) return "";
  const [hh, mm] = t.split(":").map(Number);
  return `${hh % 12 || 12}:${String(mm).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
}

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d))
  );
}

function byDueThenPriority(a: DigestTask, b: DigestTask): number {
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return (
    a.dueDate.localeCompare(b.dueDate) ||
    (a.dueTime || "99").localeCompare(b.dueTime || "99") ||
    (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1)
  );
}

export function groupDigestTasks(tasks: DigestTask[], today: string) {
  const weekEnd = addDaysToDateString(today, 7);
  const sorted = [...tasks].sort(byDueThenPriority);
  return {
    today: sorted.filter((t) => t.dueDate === today),
    overdue: sorted.filter((t) => t.dueDate < today),
    upcoming: sorted.filter((t) => t.dueDate > today && t.dueDate <= weekEnd)
  };
}

export function buildDigestEmail(input: DigestInput): DigestEmail {
  const groups = groupDigestTasks(input.tasks, input.today);
  const name = (input.firstName || "").trim();
  const hello = name ? `Good morning, ${name}.` : "Good morning.";

  const parts: string[] = [];
  if (groups.today.length) parts.push(`${groups.today.length} due today`);
  if (groups.overdue.length) parts.push(`${groups.overdue.length} overdue`);
  const subject = parts.length ? `Your day: ${parts.join(", ")}` : "Your day: a clear one";

  const sections: { title: string; items: DigestTask[]; empty: string; showDay: boolean; tone: string }[] = [
    { title: "Today", items: groups.today, empty: "Nothing due today. A clear day.", showDay: false, tone: "#d96c3f" },
    { title: "Overdue", items: groups.overdue, empty: "Nothing overdue. Nicely done.", showDay: true, tone: "#c0392b" },
    { title: "Coming up this week", items: groups.upcoming, empty: "Nothing else this week yet.", showDay: true, tone: "#2f7d59" }
  ];

  const taskLine = (t: DigestTask, showDay: boolean) => {
    const when = [showDay ? formatDay(t.dueDate) : "", formatTime(t.dueTime)].filter(Boolean).join(", ");
    return { title: t.title, when, high: t.priority === "high" };
  };

  // ----- plain text -----
  const textLines: string[] = [hello, ""];
  for (const s of sections) {
    textLines.push(s.title.toUpperCase());
    if (!s.items.length) textLines.push(`  ${s.empty}`);
    s.items.slice(0, MAX_PER_SECTION).forEach((t) => {
      const l = taskLine(t, s.showDay);
      textLines.push(`  - ${l.title}${l.when ? ` (${l.when})` : ""}${l.high ? " [high priority]" : ""}`);
    });
    if (s.items.length > MAX_PER_SECTION) textLines.push(`  …and ${s.items.length - MAX_PER_SECTION} more`);
    textLines.push("");
  }
  textLines.push(`Open Momentum: ${input.appUrl}`, "", `Stop these emails: ${input.unsubscribeUrl}`);

  // ----- HTML (inline styles, single column, works on phones) -----
  const sectionHtml = sections
    .map((s) => {
      const rows = s.items.slice(0, MAX_PER_SECTION).map((t) => {
        const l = taskLine(t, s.showDay);
        return `<tr><td style="padding:10px 0;border-bottom:1px solid #eadfce;font-size:16px;line-height:1.4;color:#22170d;">${escapeHtml(l.title)}${
          l.high ? ' <span style="color:#c0392b;font-size:13px;font-weight:600;">High priority</span>' : ""
        }${l.when ? `<br><span style="font-size:13px;color:#685948;">${escapeHtml(l.when)}</span>` : ""}</td></tr>`;
      });
      if (!s.items.length) {
        rows.push(`<tr><td style="padding:10px 0;font-size:15px;color:#685948;">${escapeHtml(s.empty)}</td></tr>`);
      }
      if (s.items.length > MAX_PER_SECTION) {
        rows.push(`<tr><td style="padding:10px 0;font-size:14px;color:#685948;">…and ${s.items.length - MAX_PER_SECTION} more</td></tr>`);
      }
      return `<h2 style="margin:28px 0 4px;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:${s.tone};">${escapeHtml(
        s.title
      )}</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4efe7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe7;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff8ef;border-radius:16px;"><tr><td style="padding:28px 24px;">
<p style="margin:0 0 4px;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#d96c3f;">Momentum</p>
<h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:#22170d;">${escapeHtml(hello)}</h1>
<p style="margin:8px 0 0;font-size:15px;color:#524335;">Here's your day at a glance.</p>
${sectionHtml}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:32px 0 8px;"><tr><td style="border-radius:999px;background:#d96c3f;">
<a href="${escapeHtml(input.appUrl)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">Open Momentum</a>
</td></tr></table>
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#685948;">You asked Momentum to email you your day each morning.<br><a href="${escapeHtml(
    input.unsubscribeUrl
  )}" style="color:#685948;">Stop these emails</a></p>
</td></tr></table>
</body></html>`;

  return {
    subject,
    html,
    text: textLines.join("\n"),
    counts: { today: groups.today.length, overdue: groups.overdue.length, upcoming: groups.upcoming.length }
  };
}

// -----------------------------------------------------------------------------
// Sending (Brevo transactional email API)
// -----------------------------------------------------------------------------

async function sendWithBrevo(env: Env, to: { email: string; name?: string }, email: DigestEmail, unsubscribeUrl: string) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY as string,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      sender: { email: env.DIGEST_FROM_EMAIL, name: "Momentum" },
      to: [to],
      subject: email.subject,
      htmlContent: email.html,
      textContent: email.text,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
      }
    })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Brevo ${res.status}: ${detail.slice(0, 200)}`);
  }
}

/** Sends today's email to everyone who opted in. Skips people with nothing due in the next week. */
export async function runDailyDigest({ appUrl, now = new Date(), env = process.env }: { appUrl: string; now?: Date; env?: Env }) {
  if (!isDigestConfigured(env)) return { configured: false, sent: 0, skipped: 0, failed: 0 };

  const db = getDbHttp();
  const recipients = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      timezone: schema.userSettings.timezone
    })
    .from(schema.userSettings)
    .innerJoin(schema.users, eq(schema.users.id, schema.userSettings.userId))
    .where(and(eq(schema.userSettings.dailyEmail, true), isNotNull(schema.users.email)));

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of recipients) {
    try {
      const today = localDateString(now, r.timezone || "UTC");
      const rows = await db
        .select({
          title: schema.tasks.title,
          dueDate: schema.tasks.dueDate,
          dueTime: schema.tasks.dueTime,
          priority: schema.tasks.priority
        })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.userId, r.userId),
            eq(schema.tasks.completed, false),
            isNotNull(schema.tasks.dueDate),
            lte(schema.tasks.dueDate, addDaysToDateString(today, 7))
          )
        );

      if (rows.length === 0) {
        skipped++;
        continue;
      }

      const unsubscribeUrl = `${appUrl}/api/email/unsubscribe?token=${encodeURIComponent(
        signUnsubscribeToken(r.userId, env.CRON_SECRET as string)
      )}`;
      const email = buildDigestEmail({
        firstName: (r.displayName || "").trim().split(/\s+/)[0] || null,
        today,
        tasks: rows.map((t) => ({ title: t.title, dueDate: t.dueDate as string, dueTime: t.dueTime, priority: t.priority })),
        appUrl,
        unsubscribeUrl
      });
      await sendWithBrevo(env, { email: r.email as string, name: r.displayName || undefined }, email, unsubscribeUrl);
      sent++;
    } catch (err) {
      failed++;
      console.error("[daily-email] send failed for a recipient:", err);
    }
  }

  return { configured: true, sent, skipped, failed };
}

/** Turns the email off for the user in a signed unsubscribe link. */
export async function unsubscribeUser(userId: string) {
  const db = getDbHttp();
  await db
    .update(schema.userSettings)
    .set({ dailyEmail: false, updatedAt: new Date() })
    .where(eq(schema.userSettings.userId, userId));
}
