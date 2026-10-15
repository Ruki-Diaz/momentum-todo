import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../server/errors.js";
import { validateSettingsInput } from "../server/validators.js";
import {
  buildDigestEmail,
  isAuthorizedCron,
  isDigestConfigured,
  localDateString,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  type DigestTask
} from "../server/digest.js";

const base = {
  firstName: "Priya",
  today: "2026-10-15",
  appUrl: "https://momentumtodo.vercel.app",
  unsubscribeUrl: "https://momentumtodo.vercel.app/api/email/unsubscribe?token=abc"
};
const task = (title: string, dueDate: string, extra: Partial<DigestTask> = {}): DigestTask => ({
  title,
  dueDate,
  dueTime: null,
  priority: "medium",
  ...extra
});

// ---------- email builder ----------
test("escapes task text in the HTML version", () => {
  const email = buildDigestEmail({ ...base, tasks: [task('<script>alert("x")</script> & co', "2026-10-15")] });
  assert.ok(!email.html.includes("<script>alert"));
  assert.ok(email.html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co"));
  assert.ok(email.text.includes('<script>alert("x")</script> & co'), "plain text keeps the original words");
});

test("escapes the first name", () => {
  const email = buildDigestEmail({ ...base, firstName: "<b>Sam</b>", tasks: [] });
  assert.ok(email.html.includes("Good morning, &lt;b&gt;Sam&lt;/b&gt;."));
});

test("empty days read calmly and the subject says so", () => {
  const email = buildDigestEmail({ ...base, firstName: null, tasks: [] });
  assert.equal(email.subject, "Your day: a clear one");
  assert.ok(email.html.includes("Nothing due today. A clear day."));
  assert.ok(email.html.includes("Nothing overdue."));
  assert.ok(email.text.startsWith("Good morning."));
  assert.deepEqual(email.counts, { today: 0, overdue: 0, upcoming: 0 });
});

test("groups today, overdue and this week; ignores later tasks", () => {
  const email = buildDigestEmail({
    ...base,
    tasks: [
      task("Send contract", "2026-10-15", { dueTime: "15:00:00", priority: "high" }),
      task("Expense report", "2026-10-12"),
      task("Board prep", "2026-10-20"),
      task("Holiday planning", "2026-11-30")
    ]
  });
  assert.deepEqual(email.counts, { today: 1, overdue: 1, upcoming: 1 });
  assert.equal(email.subject, "Your day: 1 due today, 1 overdue");
  assert.ok(email.text.includes("Send contract (3:00 PM) [high priority]"));
  assert.ok(email.text.includes("Expense report (Mon 12 Oct)"));
  assert.ok(!email.text.includes("Holiday planning"));
});

test("shows at most 5 per section with an 'and N more' line", () => {
  const tasks = Array.from({ length: 8 }, (_, i) => task(`Overdue ${i + 1}`, "2026-10-10"));
  const email = buildDigestEmail({ ...base, tasks });
  assert.ok(email.text.includes("Overdue 5"));
  assert.ok(!email.text.includes("Overdue 6"));
  assert.ok(email.text.includes("…and 3 more"));
});

test("has an Open Momentum button and an unsubscribe link", () => {
  const email = buildDigestEmail({ ...base, tasks: [] });
  assert.ok(email.html.includes(`href="${base.appUrl}"`));
  assert.ok(email.html.includes("Open Momentum"));
  assert.ok(email.html.includes("unsubscribe?token=abc"));
  assert.ok(email.text.includes(base.unsubscribeUrl));
});

// ---------- unsubscribe tokens ----------
const userId = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

test("unsubscribe tokens verify with the right secret only", () => {
  const token = signUnsubscribeToken(userId, "s3cret");
  assert.equal(verifyUnsubscribeToken(token, "s3cret"), userId);
  assert.equal(verifyUnsubscribeToken(token, "other"), null);
  assert.equal(verifyUnsubscribeToken(token, undefined), null);
});

test("tampered or malformed tokens are rejected", () => {
  const token = signUnsubscribeToken(userId, "s3cret");
  const otherUser = "00000000-0000-4000-8000-000000000000";
  assert.equal(verifyUnsubscribeToken(token.replace(userId, otherUser), "s3cret"), null);
  assert.equal(verifyUnsubscribeToken(`${token}x`, "s3cret"), null);
  assert.equal(verifyUnsubscribeToken("nonsense", "s3cret"), null);
  assert.equal(verifyUnsubscribeToken(undefined, "s3cret"), null);
});

// ---------- cron auth & configuration ----------
test("cron requests need the exact bearer secret", () => {
  assert.equal(isAuthorizedCron("Bearer abc", "abc"), true);
  assert.equal(isAuthorizedCron("Bearer abd", "abc"), false);
  assert.equal(isAuthorizedCron("abc", "abc"), false);
  assert.equal(isAuthorizedCron(undefined, "abc"), false);
  assert.equal(isAuthorizedCron("Bearer undefined", undefined), false);
  assert.equal(isAuthorizedCron(["Bearer abc"], "abc"), false);
});

test("the email feature is off unless all three settings exist", () => {
  assert.equal(isDigestConfigured({}), false);
  assert.equal(isDigestConfigured({ BREVO_API_KEY: "k", DIGEST_FROM_EMAIL: "a@b.co" }), false);
  assert.equal(isDigestConfigured({ BREVO_API_KEY: "k", DIGEST_FROM_EMAIL: "a@b.co", CRON_SECRET: "s" }), true);
});

test("today is worked out in the user's timezone", () => {
  const now = new Date("2026-10-15T20:00:00Z");
  assert.equal(localDateString(now, "Australia/Sydney"), "2026-10-16");
  assert.equal(localDateString(now, "America/New_York"), "2026-10-15");
  assert.equal(localDateString(now, "Not/AZone"), "2026-10-15");
});

// ---------- settings validation ----------
const rejects = (fn: () => unknown) =>
  assert.throws(fn, (err: unknown) => err instanceof ApiError && err.statusCode === 400);

test("settings accept dailyEmail and an hour from 0 to 23", () => {
  assert.deepEqual(validateSettingsInput({ dailyEmail: true, dailyEmailHour: 8 }), { dailyEmail: true, dailyEmailHour: 8 });
  rejects(() => validateSettingsInput({ dailyEmail: "yes" }));
  rejects(() => validateSettingsInput({ dailyEmailHour: 24 }));
  rejects(() => validateSettingsInput({ dailyEmailHour: 7.5 }));
});
