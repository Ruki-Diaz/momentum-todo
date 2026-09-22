import type { VercelRequest, VercelResponse } from "@vercel/node";
import { eq } from "drizzle-orm";
import { requireAuthUser } from "../../server/auth.js";
import { getDbPool, schema } from "../../server/db.js";
import { createErrorResponse } from "../../server/errors.js";
import { validateDisplayName } from "../../server/validators.js";

/**
 * Serializes a safe user payload for the client.
 * Never exposes internal DB credentials or Clerk secrets.
 */
function serializeUser(user: {
  id: string;
  authProviderId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    authProviderId: user.authProviderId,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt instanceof Date
      ? user.createdAt.toISOString()
      : new Date(user.createdAt).toISOString()
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ==========================================================================
  // GET /api/auth/me — Return current authenticated user profile
  // ==========================================================================
  if (req.method === "GET") {
    try {
      const user = await requireAuthUser(req);
      return res.status(200).json({ user: serializeUser(user) });
    } catch (error) {
      const errorPayload = createErrorResponse(error);
      return res.status(errorPayload.statusCode).json(errorPayload.body);
    }
  }

  // ==========================================================================
  // PATCH /api/auth/me — Update Momentum profile (display name only)
  // Identity is derived exclusively from the verified Clerk session token.
  // The request body may only update supported profile fields.
  // ==========================================================================
  if (req.method === "PATCH") {
    try {
      // 1. Verify identity from token — never trust body for ownership
      const user = await requireAuthUser(req);

      // 2. Validate request body structure
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "Request body must be a JSON object." }
        });
      }

      // 3. Reject unknown fields — only displayName is accepted
      const allowedFields = new Set(["displayName"]);
      const receivedFields = Object.keys(body);
      const unknownFields = receivedFields.filter((f) => !allowedFields.has(f));
      if (unknownFields.length > 0) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: `Unsupported profile field(s): ${unknownFields.join(", ")}. Only displayName is accepted.`
          }
        });
      }

      if (!("displayName" in body)) {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "Request body must include displayName." }
        });
      }

      // 4. Validate display name (server-authoritative validation)
      const displayName = validateDisplayName(body.displayName);

      // 5. Update Neon — ownership enforced by WHERE users.id = verified user's id
      const db = getDbPool();
      const result = await db
        .update(schema.users)
        .set({ displayName, updatedAt: new Date() })
        .where(eq(schema.users.id, user.id))
        .returning();

      const updated = result[0];
      if (!updated) {
        return res.status(500).json({
          error: { code: "INTERNAL_ERROR", message: "Failed to update user profile." }
        });
      }

      return res.status(200).json({ user: serializeUser(updated) });
    } catch (error) {
      const errorPayload = createErrorResponse(error);
      return res.status(errorPayload.statusCode).json(errorPayload.body);
    }
  }

  // ==========================================================================
  // DELETE /api/auth/me — Delete Momentum account and cloud data
  // Identity is derived strictly from verified Clerk session token.
  // 1. Transactionally wipes all Neon user data (with ON DELETE CASCADE).
  // 2. Attempts deletion of Clerk user identity with bounded retry.
  // 3. Handles partial failure explicitly if Clerk identity deletion fails.
  // ==========================================================================
  if (req.method === "DELETE") {
    try {
      // 1. Verify identity from token — never trust client body for ownership
      const user = await requireAuthUser(req);
      const authProviderId = user.authProviderId;
      const userId = user.id;

      // 2. Transactionally delete Neon database record (cascades to all user tables)
      const db = getDbPool();
      await db.transaction(async (tx) => {
        await tx.delete(schema.users).where(eq(schema.users.id, userId));
      });

      // 3. Attempt Clerk account deletion with bounded retries for transient failures
      const { clerkClient } = await import("../../server/auth.js");
      let clerkDeleted = false;
      let clerkLastError: string | null = null;
      const maxRetries = 2;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await clerkClient.users.deleteUser(authProviderId);
          clerkDeleted = true;
          break;
        } catch (clerkErr: any) {
          clerkLastError = clerkErr?.message || "Unknown error";
          console.warn(`[AccountDeletion] Clerk deletion attempt ${attempt}/${maxRetries} failed:`, clerkLastError);
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        }
      }

      // If Clerk deletion failed after bounded retries, report partial deletion explicitly
      if (!clerkDeleted) {
        console.error(`[AccountDeletion] Partial failure for user ${userId} (Clerk ID ${authProviderId}): Neon deleted, Clerk deletion failed.`);
        return res.status(200).json({
          success: false,
          status: "PARTIAL_DELETION",
          error: {
            code: "CLERK_DELETION_FAILED",
            message: "Momentum cloud workspace data was permanently deleted from the database, but removing the authentication identity from the authentication provider failed. Manual administrative cleanup is required.",
            details: clerkLastError
          }
        });
      }

      return res.status(200).json({
        success: true,
        status: "COMPLETED",
        message: "Account and cloud workspace data permanently deleted."
      });
    } catch (error) {
      const errorPayload = createErrorResponse(error);
      return res.status(errorPayload.statusCode).json(errorPayload.body);
    }
  }

  // ==========================================================================
  // Method not allowed
  // ==========================================================================
  res.setHeader("Allow", "GET, PATCH, DELETE");
  return res.status(405).json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: `Method ${req.method} is not allowed on this endpoint.`
    }
  });
}
