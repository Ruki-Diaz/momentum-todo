import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { requireAuthUser } from "../../server/auth.js";
import { getDbPool, schema } from "../../server/db.js";
import { and, eq, asc, sql } from "drizzle-orm";
import { isValidUuid, validateTaskInput, validateVersion } from "../../server/validators.js";
import { calculateNextDueDate } from "../../server/recurrence.js";
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

    // ==========================================================================
    // POST /api/tasks/[id]/complete — Complete task & generate recurrence
    // ==========================================================================
    if (req.method === "POST" && (req.query.action === "complete" || req.url?.includes("/complete"))) {
      const rawVersion = req.body?.version !== undefined ? req.body.version : undefined;
      const expectedVersion = rawVersion !== undefined ? validateVersion(rawVersion, "version") : undefined;

      const result = await db.transaction(async (tx) => {
        // 1. Lock and fetch the current task
        const existingTasks = await tx.execute(
          sql`SELECT * FROM ${schema.tasks} WHERE id = ${taskId} AND user_id = ${user.id} FOR UPDATE`
        );

        const rows: any[] = existingTasks.rows || existingTasks;
        if (rows.length === 0) {
          throw new ApiError(404, "NOT_FOUND", "Task not found");
        }

        const task: typeof schema.tasks.$inferSelect = {
          id: rows[0].id,
          userId: rows[0].user_id,
          projectId: rows[0].project_id,
          title: rows[0].title,
          description: rows[0].description,
          priority: rows[0].priority,
          dueDate: rows[0].due_date,
          dueTime: rows[0].due_time,
          completed: rows[0].completed,
          completedAt: rows[0].completed_at ? new Date(rows[0].completed_at) : null,
          notes: rows[0].notes,
          reminder: rows[0].reminder,
          recurrence: rows[0].recurrence,
          recurrenceSeriesId: rows[0].recurrence_series_id,
          generatedNextOccurrenceId: rows[0].generated_next_occurrence_id,
          legacySource: rows[0].legacy_source || null,
          legacyId: rows[0].legacy_id || null,
          version: rows[0].version,
          createdAt: new Date(rows[0].created_at),
          updatedAt: new Date(rows[0].updated_at)
        };

        // 2. Concurrency check
        if (expectedVersion !== undefined && task.version !== expectedVersion) {
          throw new ApiError(409, "STALE_VERSION", "This task was updated on another device.");
        }

        // Fetch existing subtasks and tags
        const currentSubtasks = await tx
          .select()
          .from(schema.subtasks)
          .where(and(eq(schema.subtasks.taskId, taskId), eq(schema.subtasks.userId, user.id)))
          .orderBy(asc(schema.subtasks.position), asc(schema.subtasks.createdAt));

        const currentTags = await tx
          .select()
          .from(schema.taskTags)
          .where(and(eq(schema.taskTags.taskId, taskId), eq(schema.taskTags.userId, user.id)));

        const tagStrings = currentTags.map((t) => t.tag);

        // If already completed, return idempotent response
        if (task.completed) {
          return {
            task: serializeTask(task, currentSubtasks, tagStrings),
            nextOccurrence: null
          };
        }

        const now = new Date();
        const isRecurring = task.recurrence && task.recurrence !== "none";

        if (!isRecurring) {
          // Simple non-recurring completion
          const updated = await tx
            .update(schema.tasks)
            .set({
              completed: true,
              completedAt: now,
              version: task.version + 1,
              updatedAt: now
            })
            .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, user.id)))
            .returning();

          return {
            task: serializeTask(updated[0], currentSubtasks, tagStrings),
            nextOccurrence: null
          };
        }

        // Recurring Task Handling
        const seriesId = task.recurrenceSeriesId || crypto.randomUUID();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const nextDueDate = calculateNextDueDate(task.dueDate || todayStr, task.recurrence);

        let nextTaskRecord: typeof schema.tasks.$inferSelect | null = null;
        let nextSubtasksRecords: (typeof schema.subtasks.$inferSelect)[] = [];
        let nextTagStrings: string[] = [];

        if (nextDueDate) {
          // Check if an active occurrence already exists for this series on nextDueDate
          const existingNext = await tx
            .select()
            .from(schema.tasks)
            .where(
              and(
                eq(schema.tasks.userId, user.id),
                eq(schema.tasks.recurrenceSeriesId, seriesId),
                eq(schema.tasks.dueDate, nextDueDate),
                eq(schema.tasks.completed, false)
              )
            )
            .limit(1);

          if (existingNext.length === 0) {
            // Create exactly ONE next occurrence
            const insertedNextList = await tx
              .insert(schema.tasks)
              .values({
                userId: user.id,
                projectId: task.projectId,
                title: task.title,
                description: task.description,
                priority: task.priority,
                dueDate: nextDueDate,
                dueTime: task.dueTime,
                completed: false,
                completedAt: null,
                notes: task.notes,
                reminder: task.reminder,
                recurrence: task.recurrence,
                recurrenceSeriesId: seriesId,
                generatedNextOccurrenceId: null,
                version: 1,
                createdAt: now,
                updatedAt: now
              })
              .returning();

            nextTaskRecord = insertedNextList[0];

            // Clone subtasks with incomplete status & fresh UUIDs
            if (currentSubtasks.length > 0) {
              for (const s of currentSubtasks) {
                const insertedSt = await tx
                  .insert(schema.subtasks)
                  .values({
                    taskId: nextTaskRecord.id,
                    userId: user.id,
                    title: s.title,
                    completed: false,
                    position: s.position,
                    version: 1,
                    createdAt: now,
                    updatedAt: now
                  })
                  .returning();
                nextSubtasksRecords.push(insertedSt[0]);
              }
            }

            // Clone tags
            if (tagStrings.length > 0) {
              for (const tag of tagStrings) {
                await tx.insert(schema.taskTags).values({
                  taskId: nextTaskRecord.id,
                  userId: user.id,
                  tag,
                  createdAt: now
                });
                nextTagStrings.push(tag);
              }
            }
          }
        }

        // Mark current task complete and link to next occurrence
        const updatedOriginal = await tx
          .update(schema.tasks)
          .set({
            completed: true,
            completedAt: now,
            recurrenceSeriesId: seriesId,
            generatedNextOccurrenceId: nextTaskRecord ? nextTaskRecord.id : task.generatedNextOccurrenceId,
            version: task.version + 1,
            updatedAt: now
          })
          .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, user.id)))
          .returning();

        return {
          task: serializeTask(updatedOriginal[0], currentSubtasks, tagStrings),
          nextOccurrence: nextTaskRecord
            ? serializeTask(nextTaskRecord, nextSubtasksRecords, nextTagStrings)
            : null
        };
      });

      return res.status(200).json({ data: result });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
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
