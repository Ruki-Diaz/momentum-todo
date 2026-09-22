/**
 * Momentum Intelligence — Centralized AI Configuration
 *
 * Reads AI configuration from environment variables.
 * ALL AI configuration is server-side only.
 * OPENAI_API_KEY is NEVER exposed to the browser or logged.
 */

export interface AIConfig {
  /** Whether Momentum Intelligence is active. Default: false */
  enabled: boolean;
  /** Provider identifier: "openai" | "stub". Default: "stub" */
  provider: string;
  /** Model name. Default: "gpt-5.6-luna" */
  model: string;
  /** Maximum number of tasks included in AI context. Default: 50 */
  maxContextTasks: number;
  /** Request timeout in milliseconds. Default: 15000 */
  timeoutMs: number;
  /** Maximum input characters sent to AI per request. Default: 8000 */
  maxInputChars: number;
  /** Maximum output tokens requested from model. Default: 1024 */
  maxOutputTokens: number;
  /** Daily request limit per user. Default: 25 */
  dailyRequestLimit: number;
  /** Is stub provider (dev/test mode). Never use in production for live results. */
  isStub: boolean;
}

let _config: AIConfig | null = null;

export function getAIConfig(): AIConfig {
  if (_config) return _config;

  const enabled = process.env.AI_ENABLED === "true";
  const provider = process.env.AI_PROVIDER || "stub";
  const model = process.env.AI_MODEL || (provider === "google" ? "gemini-3.1-flash-lite" : "gpt-5.6-luna");
  const maxContextTasks = parseInt(process.env.AI_MAX_CONTEXT_TASKS || "50", 10);
  const timeoutMs = parseInt(process.env.AI_TIMEOUT_MS || "15000", 10);
  const dailyRequestLimit = parseInt(process.env.AI_DAILY_REQUEST_LIMIT || "25", 10);

  _config = {
    enabled,
    provider,
    model,
    maxContextTasks: isNaN(maxContextTasks) ? 50 : Math.min(maxContextTasks, 100),
    timeoutMs: isNaN(timeoutMs) ? 15000 : Math.min(timeoutMs, 30000),
    maxInputChars: 8000,
    maxOutputTokens: 1024,
    dailyRequestLimit: isNaN(dailyRequestLimit) || dailyRequestLimit <= 0 ? 25 : dailyRequestLimit,
    isStub: !enabled || provider === "stub"
  };

  return _config;
}

/** Reset cached config (useful for tests). */
export function resetAIConfig(): void {
  _config = null;
}

/**
 * Returns the OpenAI API key from environment.
 * This function may ONLY be called server-side.
 * The key is NEVER returned to the browser.
 */
export function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY environment variable is not set. " +
      "Configure it in Vercel environment settings (server-only)."
    );
  }
  return key;
}

/**
 * Returns the Gemini API key from environment.
 * This function may ONLY be called server-side.
 * The key is NEVER returned to the browser or logged.
 */
export function getGeminiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY environment variable is not set. " +
      "Configure it in server environment settings (server-only)."
    );
  }
  return key;
}
