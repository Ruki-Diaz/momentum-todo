import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuthUser } from "../../server/auth.js";
import { getDbPool, schema } from "../../server/db.js";
import { and, eq, asc } from "drizzle-orm";
import { isValidUuid, validateTaskInput, validateVersion } from "../../server/validators.js";
import { serializeTask } from "../../server/serializers.js";
import { ApiError, createErrorResponse } from "../../server/errors.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuthUser(req);
    const db = getDbPool();

    const taskId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    if (!taskId || !isValidUuid(taskId)) {
      throw new ApiError(404, "NOT_FOUND", "Task not found");
    }

    if (req.method === "GET") {
      const existing = await db
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, user.id)))
        .limit(1);

      if (existing.length === 0) {
        throw new ApiError(404, "NOT_FOUND", "Task not found");
      }

      const task = existing[0];

      const subtasks = await db
        .select()
        .from(schema.subtasks)
        .where(and(eq(schema.subtasks.taskId, taskId), eq(schema.subtasks.userId, user.id)))
        .orderBy(asc(schema.subtasks.position), asc(schema.subtasks.createdAt));

      const taskTags = await db
        .select()
        .from(schema.taskTags)
        .where(and(eq(schema.taskTags.taskId, taskId), eq(schema.taskTags.userId, user.id)));

      return res.status(200).json({
        data: serializeTask(task, subtasks, taskTags.map((t) => t.tag))
      });
    }

    if (req.method === "PATCH") {
      const input = validateTaskInput(req.body, true);

      const result = await db.transaction(async (tx) => {
        // Query existing task
        const existing = await tx
          .select()
          .from(schema.tasks)
          .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, user.id)))
          .limit(1);

        if (existing.length === 0) {
          throw new ApiError(404, "NOT_FOUND", "Task not found");
        }

        const task = existing[0];
        if (task.version !== input.version) {
          throw new ApiError(409, "STALE_VERSION", "This task was updated on another device.");
        }

        // Validate projectId ownership if changing
        if (input.projectId !== undefined && input.projectId !== null) {
          const project = await tx
            .select({ id: schema.projects.id })
            .from(schema.projects)
            .where(and(eq(schema.projects.id, input.projectId), eq(schema.projects.userId, user.id)))
            .limit(1);

          if (project.length === 0) {
            throw new ApiError(404, "NOT_FOUND", "Project not found");
          }
        }

        // Completion state logic
        let completedAt = task.completedAt;
        if (input.completed !== undefined) {
          if (input.completed === true) {
            completedAt = input.completedAt ?? (task.completed ? task.completedAt : new Date());
          } else {
            completedAt = null;
          }
        } else if (input.completedAt !== undefined) {
          completedAt = input.completedAt;
        }

        const updatedTasks = await tx
          .update(schema.tasks)
          .set({
            title: input.title !== undefined ? input.title : task.title,
            description: input.description !== undefined ? input.description : task.description,
            priority: input.priority !== undefined ? input.priority : task.priority,
            dueDate: input.dueDate !== undefined ? input.dueDate : task.dueDate,
            dueTime: input.dueTime !== undefined ? input.dueTime : task.dueTime,
            projectId: input.projectId !== undefined ? input.projectId : task.projectId,
            completed: input.completed !== undefined ? input.completed : task.completed,
            completedAt,
            notes: input.notes !== undefined ? input.notes : task.notes,
            reminder: input.reminder !== undefined ? input.reminder : task.reminder,
            recurrence: input.recurrence !== undefined ? input.recurrence : task.recurrence,
            recurrenceSeriesId:
              input.recurrenceSeriesId !== undefined ? input.recurrenceSeriesId : task.recurrenceSeriesId,
            generatedNextOccurrenceId:
              input.generatedNextOccurrenceId !== undefined
                ? input.generatedNextOccurrenceId
                : task.generatedNextOccurrenceId,
            version: task.version + 1,
            updatedAt: new Date()
          })
          .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, user.id)))
          .returning();

        const updatedTask = updatedTasks[0];

        // Synchronize tags if supplied
        let finalTags: string[] = [];
        if (input.tags !== undefined) {
          await tx
            .delete(schema.taskTags)
            .where(and(eq(schema.taskTags.taskId, taskId), eq(schema.taskTags.userId, user.id)));

          for (const tag of input.tags) {
            await tx.insert(schema.taskTags).values({
              taskId,
              userId: user.id,
              tag,
              createdAt: new Date()
            });
          }
          finalTags = input.tags;
        } else {
          const currentTags = await tx
            .select()
            .from(schema.taskTags)
            .where(and(eq(schema.taskTags.taskId, taskId), eq(schema.taskTags.userId, user.id)));
          finalTags = currentTags.map((t) => t.tag);
        }

        // Subtasks are untouched here (they have dedicated endpoints)
        const currentSubtasks = await tx
          .select()
          .from(schema.subtasks)
          .where(and(eq(schema.subtasks.taskId, taskId), eq(schema.subtasks.userId, user.id)))
          .orderBy(asc(schema.subtasks.position), asc(schema.subtasks.createdAt));

        return serializeTask(updatedTask, currentSubtasks, finalTags);
      });

      return res.status(200).json({ data: result });
    }

    if (req.method === "DELETE") {
      const existing = await db
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, user.id)))
        .limit(1);

      if (existing.length === 0) {
        throw new ApiError(404, "NOT_FOUND", "Task not found");
      }

      const task = existing[0];

      // Enforce version check if supplied
      const rawVersion = req.body?.version ?? (req.query.version ? Number(req.query.version) : undefined);
      if (rawVersion !== undefined) {
        const expectedVersion = validateVersion(rawVersion, "version");
        if (task.version !== expectedVersion) {
          throw new ApiError(409, "STALE_VERSION", "This task was modified on another device.");
        }
      }

      await db
        .delete(schema.tasks)
        .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, user.id)));

      return res.status(200).json({
        success: true,
        data: { id: taskId }
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
