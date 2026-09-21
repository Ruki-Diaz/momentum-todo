import { createClerkClient } from "@clerk/backend";
import type { VercelRequest } from "@vercel/node";
import * as dotenv from "dotenv";
import { getDbPool, schema } from "./db.js";
import { ApiError } from "./errors.js";

dotenv.config({ override: true });

const secretKey = process.env.CLERK_SECRET_KEY;
const publishableKey = process.env.VITE_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY;

if (!secretKey) {
  console.warn("WARNING: CLERK_SECRET_KEY is not set in environment variables.");
}

export const clerkClient = createClerkClient({
  secretKey: secretKey || "",
  publishableKey: publishableKey || ""
});

// Configured authorized parties for local development and production
const defaultAuthorizedParties = [
  "http://localhost:8088",
  "http://127.0.0.1:8088",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
];

const customAuthorizedParties = process.env.AUTHORIZED_PARTIES
  ? process.env.AUTHORIZED_PARTIES.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

export const authorizedParties = Array.from(new Set([...defaultAuthorizedParties, ...customAuthorizedParties]));

/**
 * Converts incoming Node/Vercel request to standard Web Request for Clerk SDK
 */
export function convertToWebRequest(req: VercelRequest | Request): Request {
  if (req instanceof Request) return req;

  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:8088";
  const url = `${protocol}://${host}${req.url || ""}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        value.forEach((v) => headers.append(key, v));
      } else {
        headers.set(key, value);
      }
    }
  }

  return new Request(url, {
    method: req.method || "GET",
    headers
  });
}

/**
 * Authenticates request using official Clerk backend SDK
 * Derives verified Clerk identity. Never trusts client-supplied user parameters.
 */
export async function authenticateClerkRequest(req: VercelRequest | Request) {
  const webReq = convertToWebRequest(req);
  return await clerkClient.authenticateRequest(webReq, {
    publishableKey,
    secretKey,
    authorizedParties
  });
}

/**
 * Requires verified Clerk session and ensures user is provisioned in Neon PostgreSQL.
 * Idempotent upsert based on immutable auth_provider_id.
 */
export async function requireAuthUser(req: VercelRequest | Request) {
  const authState = await authenticateClerkRequest(req);

  if (!authState.isSignedIn) {
    const reason = authState.reason || "Authentication token missing or invalid";
    throw new ApiError(401, "UNAUTHORIZED", `Unauthorized: ${reason}`);
  }

  const auth = authState.toAuth();
  const authProviderId = auth.userId;

  if (!authProviderId) {
    throw new ApiError(401, "UNAUTHORIZED", "Unauthorized: User ID not found in session token");
  }

  // Fetch full user profile details from Clerk
  let email: string | null = null;
  let displayName: string | null = null;
  let avatarUrl: string | null = null;

  try {
    const clerkUser = await clerkClient.users.getUser(authProviderId);
    email = clerkUser.emailAddresses[0]?.emailAddress || null;
    const nameParts = [clerkUser.firstName, clerkUser.lastName].filter(Boolean);
    displayName = nameParts.length > 0 ? nameParts.join(" ") : (clerkUser.username || null);
    avatarUrl = clerkUser.imageUrl || null;
  } catch (err) {
    console.warn("Could not fetch user details from Clerk API; proceeding with authProviderId", err);
  }

  // Atomically provision / update Neon users row
  const db = getDbPool();
  const result = await db
    .insert(schema.users)
    .values({
      authProviderId,
      email,
      displayName,
      avatarUrl,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: schema.users.authProviderId,
      set: {
        email,
        displayName,
        avatarUrl,
        updatedAt: new Date()
      }
    })
    .returning();

  const user = result[0];
  if (!user) {
    throw new ApiError(500, "INTERNAL_ERROR", "Failed to provision user in database");
  }

  return user;
}
