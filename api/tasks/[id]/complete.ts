import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { requireAuthUser } from "../../../server/auth.js";
import { getDbPool, schema } from "../../../server/db.js";
import { and, eq, asc, sql } from "drizzle-orm";
import { isValidUuid, validateVersion } from "../../../server/validators.js";
import { calculateNextDueDate } from "../../../server/recurrence.js";
import { serializeTask } from "../../../server/serializers.js";
import { ApiError, createErrorResponse } from "../../../server/errors.js";

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
    const db = getDbPool();

    const taskId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    if (!taskId || !isValidUuid(taskId)) {
      throw new ApiError(404, "NOT_FOUND", "Task not found");
    }

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
  } catch (error) {
    const errorPayload = createErrorResponse(error);
    return res.status(errorPayload.statusCode).json(errorPayload.body);
  }
}
