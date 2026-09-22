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
// ---------------------------------------------------------------------------

let _provider: AIProvider | null = null;

import { createRequire } from "module";
const require = createRequire(import.meta.url);

export function getProvider(): AIProvider {
  if (_provider) return _provider;

  // Use dynamic require to avoid circular deps at module load time
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getAIConfig } = require("./config.js") as typeof import("./config.js");
  const cfg = getAIConfig();

  if (!cfg.enabled || cfg.provider === "stub") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { stubProvider } = require("./adapters/stub.js") as typeof import("./adapters/stub.js");
    _provider = stubProvider;
    return _provider!;
  }

  if (cfg.provider === "openai") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { openaiProvider } = require("./adapters/openai.js") as typeof import("./adapters/openai.js");
    _provider = openaiProvider;
    return _provider!;
  }

  if (cfg.provider === "google") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { googleProvider } = require("./adapters/google.js") as typeof import("./adapters/google.js");
    _provider = googleProvider;
    return _provider!;
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
