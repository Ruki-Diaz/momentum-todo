import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuthUser } from "../../../../server/auth.js";
import { getDbHttp, schema } from "../../../../server/db.js";
import { and, eq } from "drizzle-orm";
import { isValidUuid, validateSubtaskInput, validateVersion } from "../../../../server/validators.js";
import { serializeSubtask } from "../../../../server/serializers.js";
import { ApiError, createErrorResponse } from "../../../../server/errors.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuthUser(req);
    const db = getDbHttp();

    const taskId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    const subtaskId = Array.isArray(req.query.subtaskId) ? req.query.subtaskId[0] : req.query.subtaskId;

    if (!taskId || !isValidUuid(taskId) || !subtaskId || !isValidUuid(subtaskId)) {
      throw new ApiError(404, "NOT_FOUND", "Subtask not found");
    }

    // Verify parent task exists and belongs to user
    const parentTask = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, user.id)))
      .limit(1);

    if (parentTask.length === 0) {
      throw new ApiError(404, "NOT_FOUND", "Subtask not found");
    }

    if (req.method === "PATCH") {
      const input = validateSubtaskInput(req.body, true);

      // Verify subtask belongs to task and user
      const existing = await db
        .select()
        .from(schema.subtasks)
        .where(
          and(
            eq(schema.subtasks.id, subtaskId),
            eq(schema.subtasks.taskId, taskId),
            eq(schema.subtasks.userId, user.id)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        throw new ApiError(404, "NOT_FOUND", "Subtask not found");
      }

      const subtask = existing[0];
      if (subtask.version !== input.version) {
        throw new ApiError(409, "STALE_VERSION", "This subtask was updated on another device.");
      }

      const updated = await db
        .update(schema.subtasks)
        .set({
          title: input.title !== undefined ? input.title : subtask.title,
          completed: input.completed !== undefined ? input.completed : subtask.completed,
          position: input.position !== undefined ? input.position : subtask.position,
          version: subtask.version + 1,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(schema.subtasks.id, subtaskId),
            eq(schema.subtasks.taskId, taskId),
            eq(schema.subtasks.userId, user.id)
          )
        )
        .returning();

      return res.status(200).json({
        data: serializeSubtask(updated[0])
      });
    }

    if (req.method === "DELETE") {
      const existing = await db
        .select()
        .from(schema.subtasks)
        .where(
          and(
            eq(schema.subtasks.id, subtaskId),
            eq(schema.subtasks.taskId, taskId),
            eq(schema.subtasks.userId, user.id)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        throw new ApiError(404, "NOT_FOUND", "Subtask not found");
      }

      const subtask = existing[0];

      // Enforce version check if supplied
      const rawVersion = req.body?.version ?? (req.query.version ? Number(req.query.version) : undefined);
      if (rawVersion !== undefined) {
        const expectedVersion = validateVersion(rawVersion, "version");
        if (subtask.version !== expectedVersion) {
          throw new ApiError(409, "STALE_VERSION", "This subtask was modified on another device.");
        }
      }

      await db
        .delete(schema.subtasks)
        .where(
          and(
            eq(schema.subtasks.id, subtaskId),
            eq(schema.subtasks.taskId, taskId),
            eq(schema.subtasks.userId, user.id)
          )
        );

      return res.status(200).json({
        success: true,
        data: { id: subtaskId }
      });
    }

    res.setHeader("Allow", "PATCH, DELETE");
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
