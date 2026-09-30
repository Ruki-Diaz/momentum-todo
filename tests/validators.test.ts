import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../server/errors.js";
import {
  isValidUuid,
  validateDisplayName,
  validateTags,
  validateTaskInput,
  validateVersion
} from "../server/validators.js";

const rejects = (fn: () => unknown) =>
  assert.throws(fn, (err: unknown) => err instanceof ApiError && err.statusCode === 400 && err.code === "VALIDATION_ERROR");

test("isValidUuid accepts UUIDs and rejects everything else", () => {
  assert.equal(isValidUuid(crypto.randomUUID()), true);
  assert.equal(isValidUuid("not-a-uuid"), false);
  assert.equal(isValidUuid(42), false);
});

test("validateVersion requires a positive integer", () => {
  assert.equal(validateVersion(3), 3);
  rejects(() => validateVersion(0));
  rejects(() => validateVersion(1.5));
  rejects(() => validateVersion("2"));
});

test("validateTags lowercases, trims, dedupes, and enforces limits", () => {
  assert.deepEqual(validateTags([" Work ", "work", "HOME"]), ["work", "home"]);
  assert.deepEqual(validateTags(undefined), []);
  rejects(() => validateTags("work"));
  rejects(() => validateTags(["   "]));
  rejects(() => validateTags(["x".repeat(51)]));
  rejects(() => validateTags(Array.from({ length: 21 }, (_, i) => `t${i}`)));
});

test("validateDisplayName counts code points and rejects control characters", () => {
  assert.equal(validateDisplayName("  Ada Lovelace "), "Ada Lovelace");
  assert.equal(validateDisplayName("José Ñúñez"), "José Ñúñez");
  assert.equal(validateDisplayName("😀".repeat(50)), "😀".repeat(50)); // 50 code points, 100 UTF-16 units
  rejects(() => validateDisplayName("😀".repeat(51)));
  rejects(() => validateDisplayName("Ada\nLovelace"));
  rejects(() => validateDisplayName("   "));
});

test("validateTaskInput trims titles and validates enums", () => {
  const result = validateTaskInput({ title: "  Ship it  ", priority: "high", dueDate: "2026-10-01", dueTime: "09:30" });
  assert.equal(result.title, "Ship it");
  assert.equal(result.priority, "high");
  assert.equal(result.dueDate, "2026-10-01");
  assert.equal(result.dueTime, "09:30");

  rejects(() => validateTaskInput({ title: "" }));
  rejects(() => validateTaskInput({ title: "x".repeat(256) }));
  rejects(() => validateTaskInput({ title: "ok", priority: "urgent" }));
  rejects(() => validateTaskInput(null));
});

test("validateTaskInput rejects impossible calendar dates", () => {
  rejects(() => validateTaskInput({ title: "ok", dueDate: "2026-02-31" }));
  rejects(() => validateTaskInput({ title: "ok", dueDate: "10/01/2026" }));
  assert.equal(validateTaskInput({ title: "ok", dueDate: "" }).dueDate, null);
});

test("partial updates skip the title but require an optimistic-concurrency version", () => {
  const result = validateTaskInput({ priority: "low", version: 4 }, true);
  assert.equal(result.priority, "low");
  assert.equal(result.title, undefined);
  rejects(() => validateTaskInput({ priority: "low" }, true));
});
