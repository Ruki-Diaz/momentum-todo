/**
 * Standardized API Error Contract for Momentum V2 Backend
 * Consistent JSON response format: { error: { code, message, details? } }
 */

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "STALE_VERSION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: ApiErrorCode;
  public readonly details?: unknown;

  constructor(statusCode: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function createErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {})
        }
      }
    };
  }

  // Sanitize unexpected/internal errors so DB credentials or stack traces are never leaked
  console.error("Unhandled internal server error:", error);
  return {
    statusCode: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR" as ApiErrorCode,
        message: "An unexpected server error occurred."
      }
    }
  };
}
