import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuthUser } from "../../server/auth.js";
import { getDbPool, schema } from "../../server/db.js";
import { and, eq, desc, asc, inArray } from "drizzle-orm";
import { isValidUuid, validateTaskInput } from "../../server/validators.js";
import { serializeTask } from "../../server/serializers.js";
import { ApiError, createErrorResponse } from "../../server/errors.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuthUser(req);
    const db = getDbPool();

    if (req.method === "GET") {
      const conditions = [eq(schema.tasks.userId, user.id)];

      if (req.query.projectId && typeof req.query.projectId === "string") {
        if (!isValidUuid(req.query.projectId)) {
          throw new ApiError(404, "NOT_FOUND", "Project not found");
        }
        conditions.push(eq(schema.tasks.projectId, req.query.projectId));
      }

      if (req.query.completed !== undefined) {
        const isCompleted = req.query.completed === "true" || req.query.completed === "1";
        conditions.push(eq(schema.tasks.completed, isCompleted));
      }

      if (req.query.dueDate && typeof req.query.dueDate === "string") {
        conditions.push(eq(schema.tasks.dueDate, req.query.dueDate));
      }

      const userTasks = await db
        .select()
        .from(schema.tasks)
        .where(and(...conditions))
        .orderBy(desc(schema.tasks.createdAt));

      if (userTasks.length === 0) {
        return res.status(200).json({ data: [] });
      }

      const taskIds = userTasks.map((t) => t.id);

      // Fetch all subtasks for these tasks
      const allSubtasks = await db
        .select()
        .from(schema.subtasks)
        .where(and(eq(schema.subtasks.userId, user.id), inArray(schema.subtasks.taskId, taskIds)))
        .orderBy(asc(schema.subtasks.position), asc(schema.subtasks.createdAt));

      // Fetch all tags for these tasks
      const allTags = await db
        .select()
        .from(schema.taskTags)
        .where(and(eq(schema.taskTags.userId, user.id), inArray(schema.taskTags.taskId, taskIds)));

      const subtasksMap = new Map<string, typeof allSubtasks>();
      for (const st of allSubtasks) {
        const list = subtasksMap.get(st.taskId) || [];
        list.push(st);
        subtasksMap.set(st.taskId, list);
      }

      const tagsMap = new Map<string, string[]>();
      for (const tt of allTags) {
        const list = tagsMap.get(tt.taskId) || [];
        list.push(tt.tag);
        tagsMap.set(tt.taskId, list);
      }

      const responseTasks = userTasks.map((task) =>
        serializeTask(task, subtasksMap.get(task.id) || [], tagsMap.get(task.id) || [])
      );

      return res.status(200).json({ data: responseTasks });
    }

    if (req.method === "POST") {
      const input = validateTaskInput(req.body, false);

      // Verify project ownership if projectId is supplied
      if (input.projectId) {
        const project = await db
          .select({ id: schema.projects.id })
          .from(schema.projects)
          .where(and(eq(schema.projects.id, input.projectId), eq(schema.projects.userId, user.id)))
          .limit(1);

        if (project.length === 0) {
          // Cross-user project references must return safe 404 NOT_FOUND
          throw new ApiError(404, "NOT_FOUND", "Project not found");
        }
      }

      let completedAt: Date | null = null;
      if (input.completed === true) {
        completedAt = input.completedAt || new Date();
      }

      const result = await db.transaction(async (tx) => {
        const taskValues: typeof schema.tasks.$inferInsert = {
          userId: user.id,
          title: input.title!,
          description: input.description ?? "",
          priority: input.priority ?? "medium",
          dueDate: input.dueDate ?? null,
          dueTime: input.dueTime ?? null,
          projectId: input.projectId ?? null,
          completed: input.completed ?? false,
          completedAt,
          notes: input.notes ?? "",
          reminder: input.reminder ?? null,
          recurrence: input.recurrence ?? "none",
          recurrenceSeriesId: input.recurrenceSeriesId ?? null,
          generatedNextOccurrenceId: input.generatedNextOccurrenceId ?? null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        if (input.id) {
          taskValues.id = input.id;
        }

        const insertedTasks = await tx.insert(schema.tasks).values(taskValues).returning();
        const newTask = insertedTasks[0];

        // Insert initial subtasks if supplied
        const insertedSubtasks: (typeof schema.subtasks.$inferSelect)[] = [];
        if (input.subtasks && input.subtasks.length > 0) {
          for (let i = 0; i < input.subtasks.length; i++) {
            const st = input.subtasks[i];
            const stValues: typeof schema.subtasks.$inferInsert = {
              taskId: newTask.id,
              userId: user.id,
              title: st.title!,
              completed: st.completed ?? false,
              position: st.position !== undefined ? st.position : i,
              version: 1,
              createdAt: new Date(),
              updatedAt: new Date()
            };
            if (st.id) {
              stValues.id = st.id;
            }
            const insertedSt = await tx.insert(schema.subtasks).values(stValues).returning();
            insertedSubtasks.push(insertedSt[0]);
          }
        }

        // Insert initial tags if supplied
        const insertedTags: string[] = [];
        if (input.tags && input.tags.length > 0) {
          for (const tag of input.tags) {
            await tx.insert(schema.taskTags).values({
              taskId: newTask.id,
              userId: user.id,
              tag,
              createdAt: new Date()
            });
            insertedTags.push(tag);
          }
        }

        return serializeTask(newTask, insertedSubtasks, insertedTags);
      });

      return res.status(201).json({ data: result });
    }

    res.setHeader("Allow", "GET, POST");
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
