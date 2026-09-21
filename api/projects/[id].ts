import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuthUser } from "../../server/auth.js";
import { getDbHttp, schema } from "../../server/db.js";
import { and, eq } from "drizzle-orm";
import { isValidUuid, validateProjectInput, validateVersion } from "../../server/validators.js";
import { serializeProject } from "../../server/serializers.js";
import { ApiError, createErrorResponse } from "../../server/errors.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuthUser(req);
    const db = getDbHttp();

    const projectId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    if (!projectId || !isValidUuid(projectId)) {
      throw new ApiError(404, "NOT_FOUND", "Project not found");
    }

    if (req.method === "GET") {
      const existing = await db
        .select()
        .from(schema.projects)
        .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, user.id)))
        .limit(1);

      if (existing.length === 0) {
        throw new ApiError(404, "NOT_FOUND", "Project not found");
      }

      return res.status(200).json({
        data: serializeProject(existing[0])
      });
    }

    if (req.method === "PATCH") {
      const input = validateProjectInput(req.body, true);

      // Verify ownership
      const existing = await db
        .select()
        .from(schema.projects)
        .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, user.id)))
        .limit(1);

      if (existing.length === 0) {
        throw new ApiError(404, "NOT_FOUND", "Project not found");
      }

      const project = existing[0];
      if (project.version !== input.version) {
        throw new ApiError(409, "STALE_VERSION", "This project was updated on another device.");
      }

      const updated = await db
        .update(schema.projects)
        .set({
          name: input.name !== undefined ? input.name : project.name,
          color: input.color !== undefined ? input.color : project.color,
          version: project.version + 1,
          updatedAt: new Date()
        })
        .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, user.id)))
        .returning();

      return res.status(200).json({
        data: serializeProject(updated[0])
      });
    }

    if (req.method === "DELETE") {
      // Find project scoped to authenticated user
      const existing = await db
        .select()
        .from(schema.projects)
        .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, user.id)))
        .limit(1);

      if (existing.length === 0) {
        throw new ApiError(404, "NOT_FOUND", "Project not found");
      }

      const project = existing[0];

      // If version is provided in body or query, enforce concurrency check
      const rawVersion = req.body?.version ?? (req.query.version ? Number(req.query.version) : undefined);
      if (rawVersion !== undefined) {
        const expectedVersion = validateVersion(rawVersion, "version");
        if (project.version !== expectedVersion) {
          throw new ApiError(409, "STALE_VERSION", "This project was modified on another device.");
        }
      }

      await db
        .delete(schema.projects)
        .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, user.id)));

      return res.status(200).json({
        success: true,
        data: { id: projectId }
      });
    }

    res.setHeader("Allow", "GET, PATCH, DELETE");
    return res.status(405).json({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: `Method ${req.method} is not allowed on this endpoint.`
      }
    });
  } catch (error) {
    const errorPayload = createErrorResponse(error);
    return res.status(errorPayload.statusCode).json(errorPayload.body);
  }
}
