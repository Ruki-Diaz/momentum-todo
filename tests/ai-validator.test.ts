import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { validateCommandIntentResponse, validateParseTaskResponse } from "../server/ai/validator.js";

const invalid = (fn: () => unknown) =>
  assert.throws(fn, (err: any) => err?.code === "AI_RESPONSE_INVALID");

test("parse-task proposals are normalized", () => {
  const out = validateParseTaskResponse({
    proposal: { title: "  Call mom ", priority: "medium", dueDate: "2026-10-02", tags: ["family"] }
  });
  assert.equal(out.title, "Call mom");
  assert.equal(out.description, "");
  assert.equal(out.recurrence, "none");
  assert.equal(out.reminder, null);
  assert.deepEqual(out.tags, ["family"]);
});

test("parse-task rejects malformed model output", () => {
  invalid(() => validateParseTaskResponse({}));
  invalid(() => validateParseTaskResponse({ proposal: { title: "x", priority: "urgent" } }));
  invalid(() => validateParseTaskResponse({ proposal: { title: "x", priority: "low", dueDate: "tomorrow" } }));
  invalid(() => validateParseTaskResponse({ proposal: { title: "x", priority: "low", recurrence: "hourly" } }));
});

test("unknown intents degrade to a safe read-only UNKNOWN", () => {
  const out = validateCommandIntentResponse({ intent: "DELETE_EVERYTHING", confidence: 1 });
  assert.equal(out.intent, "UNKNOWN");
  assert.equal(out.readOnly, true);
  assert.equal(out.requiresConfirmation, false);
});

test("mutating intents always require confirmation", () => {
  const out = validateCommandIntentResponse({ intent: "UPDATE_TASKS", confidence: 7, params: { changes: { priority: "high" } } });
  assert.equal(out.requiresConfirmation, true);
  assert.equal(out.readOnly, false);
  assert.equal(out.confidence, 1); // clamped
  invalid(() => validateCommandIntentResponse({ intent: "UPDATE_TASK", params: { changes: { priority: "p0" } } }));
});

test("client escapeHtml neutralizes markup from tasks and AI output", () => {
  const context = vm.createContext({ console, crypto: globalThis.crypto });
  vm.runInContext(
    `${readFileSync(new URL("../public/js/data.js", import.meta.url), "utf8")}\nglobalThis.__client = { escapeHtml };`,
    context
  );
  const { escapeHtml } = (context as any).__client as { escapeHtml: (s: unknown) => string };
  assert.equal(escapeHtml(`<img src=x onerror="alert('1')">`), "&lt;img src=x onerror=&quot;alert(&#039;1&#039;)&quot;&gt;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(5), "5");
});
