/**
 * Momentum Intelligence — AI Provider Abstraction
 *
 * All AI capabilities depend on this interface, never on a vendor SDK directly.
 * Swap providers by implementing a new adapter without touching capability code.
 */

// ---------------------------------------------------------------------------
// Core provider interface
// ---------------------------------------------------------------------------

export interface GenerateParams {
  /** Application instructions — TRUSTED. Treated as authoritative. */
  system: string;
  /** User/workspace data — UNTRUSTED. Must be sanitized by the caller. */
  input: string;
  /** JSON Schema object describing the required output structure. */
  schema: Record<string, unknown>;
  /** Schema identifier (a-z, A-Z, 0-9, _, - max 64 chars). */
  schemaName: string;
  /** Sampling temperature (0–1). Lower = more deterministic. Default: 0.2 */
  temperature?: number;
  /** Maximum output tokens. Enforced by provider. Default: 1024 */
  maxOutputTokens?: number;
  /** Override the configured model for this specific call (optional). */
  model?: string;
}

export interface AIProvider {
  /**
   * Generates a structured response from the AI model.
   * Returns parsed, type-unsafe JSON. Callers MUST validate against
   * Momentum's own validator after receiving the result.
   */
  generateStructuredResponse(params: GenerateParams): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Provider factory — returns the configured provider singleton
import { getAIConfig } from "./config.js";
import { stubProvider } from "./adapters/stub.js";
import { openaiProvider } from "./adapters/openai.js";
import { googleProvider } from "./adapters/google.js";

let _provider: AIProvider | null = null;

export function getProvider(): AIProvider {
  if (_provider) return _provider;

  const cfg = getAIConfig();

  if (!cfg.enabled || cfg.provider === "stub") {
    _provider = stubProvider;
    return _provider;
  }

  if (cfg.provider === "openai") {
    _provider = openaiProvider;
    return _provider;
  }

  if (cfg.provider === "google") {
    _provider = googleProvider;
    return _provider;
  }

  throw new Error(
    `AI provider '${cfg.provider}' is not supported. ` +
    `Add an adapter in server/ai/adapters/ and register it here.`
  );
}

/** Reset the cached provider singleton (useful for testing). */
export function resetProvider(): void {
  _provider = null;
}
