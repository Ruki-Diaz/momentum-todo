/**
 * Momentum Intelligence — Google Gemini Adapter
 *
 * Uses the official Google GenAI Node SDK (@google/genai) with structured
 * JSON Schema output.
 *
 * SECURITY:
 * - GEMINI_API_KEY is read exclusively server-side via getGeminiKey()
 * - The key is never logged, printed, or included in any response body
 * - This module must NEVER be imported from public/ or any browser bundle
 */

import { GoogleGenAI } from "@google/genai";
import type { AIProvider, GenerateParams } from "../provider.js";
import { getAIConfig, getGeminiKey } from "../config.js";
import { AIError } from "../errors.js";

// ---------------------------------------------------------------------------
// Singleton Google GenAI client — initialized lazily on first use
// ---------------------------------------------------------------------------

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (_client) return _client;
  _client = new GoogleGenAI({
    apiKey: getGeminiKey()
  });
  return _client;
}

// ---------------------------------------------------------------------------
// Google Gemini Provider implementation
// ---------------------------------------------------------------------------

class GoogleProvider implements AIProvider {
  async generateStructuredResponse(params: GenerateParams): Promise<unknown> {
    const cfg = getAIConfig();
    const client = getClient();
    const model = params.model ?? cfg.model;

    let response: any;
    let attempts = 0;
    const maxAttempts = 3;
    // One overall budget for all attempts, so retries never push the serverless
    // function past its maxDuration.
    const deadline = Date.now() + cfg.timeoutMs;

    while (attempts < maxAttempts) {
      attempts++;
      const remainingMs = deadline - Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const generatePromise = client.models.generateContent({
          model,
          contents: params.input,
          config: {
            systemInstruction: params.system,
            responseMimeType: "application/json",
            responseSchema: params.schema,
            temperature: params.temperature ?? 0.2,
            maxOutputTokens: params.maxOutputTokens ?? cfg.maxOutputTokens
          }
        });

        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new AIError(500, "AI_TIMEOUT", `Gemini request timed out after ${cfg.timeoutMs}ms.`));
          }, remainingMs);
        });

        response = await Promise.race([generatePromise, timeoutPromise]);
        break;
      } catch (err: any) {
        if (err instanceof AIError && err.code === "AI_TIMEOUT") {
          throw err;
        }

        const status = err?.status ?? err?.statusCode;
        const msg = String(err?.message || "");
        const isCapacityError =
          status === 503 ||
          status === 500 ||
          msg.includes("UNAVAILABLE") ||
          msg.includes("high demand") ||
          msg.includes("overloaded") ||
          msg.includes("capacity");

        // Transient capacity errors: retry with exponential backoff + jitter while budget remains.
        const backoffMs = 700 * 2 ** (attempts - 1) + Math.floor(Math.random() * 300);
        if (isCapacityError && attempts < maxAttempts && deadline - Date.now() > backoffMs + 3000) {
          console.warn(`[Gemini Adapter] Transient provider capacity error (attempt ${attempts}/${maxAttempts}), retrying in ${backoffMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        // Handle 429 / quota exhaustion
        if (
          status === 429 ||
          msg.includes("RESOURCE_EXHAUSTED") ||
          msg.includes("quota") ||
          msg.includes("rate limit")
        ) {
          throw new AIError(
            429,
            "AI_RATE_LIMITED",
            "Momentum Intelligence has reached its current AI capacity. Please try again later."
          );
        }

        if (isCapacityError) {
          throw new AIError(
            503,
            "AI_UNAVAILABLE",
            "Momentum Intelligence is temporarily unavailable. Please try again shortly."
          );
        }

        if (err?.code === "ETIMEDOUT" || err?.code === "ECONNABORTED" || msg.includes("timeout")) {
          throw new AIError(500, "AI_TIMEOUT", `Gemini request timed out after ${cfg.timeoutMs}ms.`);
        }

        throw new AIError(500, "AI_PROVIDER_ERROR", `Gemini API error: ${msg}`);
      } finally {
        clearTimeout(timer);
      }
    }

    const finishReason = response?.candidates?.[0]?.finishReason;
    if (finishReason === "MAX_TOKENS") {
      throw new AIError(
        500,
        "AI_RESPONSE_INVALID",
        `Gemini response was truncated at maxOutputTokens=${params.maxOutputTokens ?? cfg.maxOutputTokens} (schema: ${params.schemaName}).`
      );
    }
    if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT" || finishReason === "BLOCKLIST") {
      throw new AIError(500, "AI_RESPONSE_INVALID", "Gemini declined to answer this request.");
    }

    // Extract structured text output
    const outputText = response?.text;
    if (!outputText || typeof outputText !== "string") {
      throw new AIError(500, "AI_RESPONSE_INVALID", "Gemini returned empty response text.");
    }

    // Parse JSON — provider schema enforcement validated structure,
    // Momentum's own validator will run a second pass after this returns
    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      throw new AIError(500, "AI_RESPONSE_INVALID", "Gemini returned non-JSON text.");
    }

    return parsed;
  }
}

export const googleProvider: AIProvider = new GoogleProvider();
