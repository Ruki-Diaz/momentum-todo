import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { calculateNextDueDate } from "../server/recurrence.js";

test("daily advances one day and crosses month/year boundaries", () => {
  assert.equal(calculateNextDueDate("2026-03-14", "daily"), "2026-03-15");
  assert.equal(calculateNextDueDate("2026-04-30", "daily"), "2026-05-01");
  assert.equal(calculateNextDueDate("2026-12-31", "daily"), "2027-01-01");
});

test("weekdays skips the weekend", () => {
  assert.equal(calculateNextDueDate("2026-10-01", "weekdays"), "2026-10-02"); // Thu -> Fri
  assert.equal(calculateNextDueDate("2026-10-02", "weekdays"), "2026-10-05"); // Fri -> Mon
  assert.equal(calculateNextDueDate("2026-10-03", "weekdays"), "2026-10-05"); // Sat -> Mon
  assert.equal(calculateNextDueDate("2026-10-04", "weekdays"), "2026-10-05"); // Sun -> Mon
});

test("weekly advances seven days", () => {
  assert.equal(calculateNextDueDate("2026-12-28", "weekly"), "2027-01-04");
});

test("monthly clamps to the last day of shorter months", () => {
  assert.equal(calculateNextDueDate("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(calculateNextDueDate("2028-01-31", "monthly"), "2028-02-29"); // leap year
  assert.equal(calculateNextDueDate("2026-03-31", "monthly"), "2026-04-30");
  assert.equal(calculateNextDueDate("2026-12-31", "monthly"), "2027-01-31");
  assert.equal(calculateNextDueDate("2026-05-15", "monthly"), "2026-06-15");
});

test("returns null for missing dates, 'none', unknown rules, and malformed input", () => {
  assert.equal(calculateNextDueDate(null, "daily"), null);
  assert.equal(calculateNextDueDate(undefined, "daily"), null);
  assert.equal(calculateNextDueDate("2026-10-01", "none"), null);
  assert.equal(calculateNextDueDate("2026-10-01", "yearly"), null);
  assert.equal(calculateNextDueDate("not-a-date", "daily"), null);
});

test("browser recurrence engine matches the server engine", () => {
  // public/js/data.js is a classic browser script; evaluate it in an isolated context.
  const context = vm.createContext({ console, crypto: globalThis.crypto });
  vm.runInContext(
    `${readFileSync(new URL("../public/js/data.js", import.meta.url), "utf8")}\nglobalThis.__client = { calculateNextDueDate };`,
    context
  );
  const client = (context as any).__client as { calculateNextDueDate: (d: string, r: string) => string | null };

  const rules = ["daily", "weekdays", "weekly", "monthly"];
  const start = new Date(2026, 0, 1);
  for (let i = 0; i < 400; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    for (const rule of rules) {
      assert.equal(client.calculateNextDueDate(iso, rule), calculateNextDueDate(iso, rule), `${iso} ${rule}`);
    }
  }
});
