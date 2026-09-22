/**
 * Momentum Intelligence — AI Error Codes
 *
 * Extends the existing Momentum error system with AI-specific codes.
 * These map to safe, non-revealing user messages in the frontend.
 */

export type AIErrorCode =
  | "AI_DISABLED"          // AI is not enabled (AI_ENABLED=false)
  | "AI_UNAVAILABLE"       // Provider is configured but unreachable
  | "AI_TIMEOUT"           // Request exceeded AI_TIMEOUT_MS
  | "AI_RATE_LIMITED"      // Too many requests
  | "AI_RESPONSE_INVALID"  // Model output failed Momentum schema validation
  | "AI_CONTEXT_TOO_LARGE" // Workspace context exceeds limits
  | "AI_PROVIDER_ERROR"    // Provider returned an error (safe message only)
  | "AI_DESTRUCTIVE_BLOCKED"; // Attempted a destructive operation via AI

import { ApiError } from "../errors.js";

export class AIError extends ApiError {
  constructor(statusCode: number, code: AIErrorCode, message: string) {
    super(statusCode, code, message);
    this.name = "AIError";
  }
}

/** Safe user-facing messages. Never reveals internal state. */
export const AI_ERROR_MESSAGES: Record<AIErrorCode, string> = {
  AI_DISABLED:
    "Momentum Intelligence is not currently available.",
  AI_UNAVAILABLE:
    "Momentum Intelligence is temporarily unavailable. Please try again shortly.",
  AI_TIMEOUT:
    "The AI took too long to respond. Please try again.",
  AI_RATE_LIMITED:
    "Momentum Intelligence has reached its current AI capacity. Please try again later.",
  AI_RESPONSE_INVALID:
    "The AI returned an unexpected response. No changes were made.",
  AI_CONTEXT_TOO_LARGE:
    "The request includes too much information. Please reduce the scope and try again.",
  AI_PROVIDER_ERROR:
    "Momentum Intelligence encountered an error. Please try again.",
  AI_DESTRUCTIVE_BLOCKED:
    "Deletion must be performed through the Momentum interface."
};

export function createAIErrorResponse(code: AIErrorCode, detail?: string) {
  const message = AI_ERROR_MESSAGES[code];
  // Never include internal detail in the response body
  if (detail) {
    console.error(`[AI] ${code}: ${detail}`);
  }
  return {
    statusCode: code === "AI_DISABLED" ? 503 : code === "AI_RATE_LIMITED" ? 429 : 500,
    body: {
      error: { code, message }
    }
  };
}
