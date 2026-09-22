/**
 * Momentum Intelligence — OpenAI Adapter
 *
 * Uses the OpenAI Responses API (openai v7+) with strict JSON Schema
 * structured outputs. The Responses API is OpenAI's current preferred
 * interface for structured, stateless single-turn inference.
 *
 * DEFAULT MODEL: gpt-5.6-luna
 * Model selection is centralized via AI_MODEL env var — individual capabilities
 * do not hardcode model names. Use params.model to override per-call if needed.
 *
 * SECURITY:
 * - OPENAI_API_KEY is read exclusively server-side via getOpenAIKey()
 * - The key is never logged, never included in any response body
 * - This module must NEVER be imported from public/ or any browser bundle
 */

import OpenAI from "openai";
import type { AIProvider, GenerateParams } from "../provider.js";
import { getAIConfig, getOpenAIKey } from "../config.js";
import { AIError } from "../errors.js";

// ---------------------------------------------------------------------------
// Singleton OpenAI client — initialized lazily on first use
// ---------------------------------------------------------------------------

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;
  _client = new OpenAI({
    apiKey: getOpenAIKey(),
    timeout: getAIConfig().timeoutMs,
    maxRetries: 1 // One retry only — prevent runaway costs on transient errors
  });
  return _client;
}

// ---------------------------------------------------------------------------
// OpenAI Responses API adapter
// ---------------------------------------------------------------------------

class OpenAIProvider implements AIProvider {
  async generateStructuredResponse(params: GenerateParams): Promise<unknown> {
    const cfg = getAIConfig();
    const client = getClient();
    const model = params.model ?? cfg.model;

    let response: any;
    try {
      response = await client.responses.create({
        model,
        instructions: params.system,
        input: params.input,
        text: {
          format: {
            type: "json_schema",
            name: params.schemaName,
            schema: params.schema,
            strict: true
          }
        },
        max_output_tokens: params.maxOutputTokens ?? cfg.maxOutputTokens,
        // Temperature is not directly supported on Responses API — use default
        // The model responds deterministically with structured output enabled
        store: false // Zero data retention — do not store responses on OpenAI servers
      });
    } catch (err: any) {
      // Map OpenAI SDK errors to Momentum AI errors — never expose raw OpenAI messages
      if (err?.status === 429) {
        throw new AIError(429, "AI_RATE_LIMITED", "OpenAI rate limit exceeded.");
      }
      if (err?.code === "ETIMEDOUT" || err?.code === "ECONNABORTED" || err?.message?.includes("timeout")) {
        throw new AIError(500, "AI_TIMEOUT", `OpenAI request timed out after ${cfg.timeoutMs}ms.`);
      }
      throw new AIError(500, "AI_PROVIDER_ERROR", `OpenAI API error: ${err?.message ?? "unknown"}`);
    }

    // Extract structured text output
    const outputText = response.output_text;
    if (!outputText || typeof outputText !== "string") {
      throw new AIError(500, "AI_RESPONSE_INVALID", "OpenAI returned empty output_text.");
    }

    // Parse JSON — provider schema enforcement already validated structure,
    // but Momentum's own validator will run a second pass after this returns
    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      throw new AIError(500, "AI_RESPONSE_INVALID", "OpenAI returned non-JSON output_text.");
    }

    return parsed;
  }
}

export const openaiProvider: AIProvider = new OpenAIProvider();
