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
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        // Execute generateContent with timeout control
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

        // Wrap with timeout
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new AIError(500, "AI_TIMEOUT", `Gemini request timed out after ${cfg.timeoutMs}ms.`));
          }, cfg.timeoutMs);
        });

        response = await Promise.race([generatePromise, timeoutPromise]);
        break;
      } catch (err: any) {
        if (err instanceof AIError && err.code === "AI_TIMEOUT") {
          throw err;
        }

        const status = err?.status ?? err?.statusCode;
        const msg = String(err?.message || "");

        // If it's a 503 / UNAVAILABLE / capacity error and we have retries remaining, wait 1s and retry
        if (
          attempts < maxAttempts &&
          (status === 503 ||
            msg.includes("UNAVAILABLE") ||
            msg.includes("high demand") ||
            msg.includes("capacity"))
        ) {
          console.warn(`[Gemini Adapter] Transient provider capacity error (attempt ${attempts}/${maxAttempts}), retrying in 1s...`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
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

        // Handle 503 / UNAVAILABLE / temporary provider capacity problems
        if (
          status === 503 ||
          msg.includes("UNAVAILABLE") ||
          msg.includes("high demand") ||
          msg.includes("capacity")
        ) {
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
      }
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
