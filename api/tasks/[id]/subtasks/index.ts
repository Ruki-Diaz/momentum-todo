import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuthUser } from "../../../../server/auth.js";
import { getDbHttp, schema } from "../../../../server/db.js";
import { and, eq, sql } from "drizzle-orm";
import { isValidUuid, validateSubtaskInput } from "../../../../server/validators.js";
import { serializeSubtask } from "../../../../server/serializers.js";
import { ApiError, createErrorResponse } from "../../../../server/errors.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: `Method ${req.method} is not allowed on this endpoint.`
      }
    });
  }

  try {
    const user = await requireAuthUser(req);
    const db = getDbHttp();

    const taskId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    if (!taskId || !isValidUuid(taskId)) {
      throw new ApiError(404, "NOT_FOUND", "Task not found");
    }

    // Verify parent task belongs to authenticated user
    const parentTask = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, user.id)))
      .limit(1);

    if (parentTask.length === 0) {
      throw new ApiError(404, "NOT_FOUND", "Task not found");
    }

    const input = validateSubtaskInput(req.body, false);

    // Compute next position if not explicitly supplied
    let position = input.position;
    if (position === undefined) {
      const posResult = await db
        .select({
          maxPos: sql<number>`COALESCE(MAX(${schema.subtasks.position}), -1)`
        })
        .from(schema.subtasks)
        .where(and(eq(schema.subtasks.taskId, taskId), eq(schema.subtasks.userId, user.id)));

      position = Number(posResult[0]?.maxPos ?? -1) + 1;
    }

    const subtaskValues: typeof schema.subtasks.$inferInsert = {
      taskId,
      userId: user.id,
      title: input.title!,
      completed: input.completed ?? false,
      position,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (input.id) {
      subtaskValues.id = input.id;
    }

    const inserted = await db.insert(schema.subtasks).values(subtaskValues).returning();

    return res.status(201).json({
      data: serializeSubtask(inserted[0])
    });
  } catch (error) {
    const errorPayload = createErrorResponse(error);
    return res.status(errorPayload.statusCode).json(errorPayload.body);
  }
}
