import type { VercelRequest, VercelResponse } from "@vercel/node";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { requireAuthUser } from "../../server/auth.js";
import { getDbPool, schema } from "../../server/db.js";
import { ApiError, createErrorResponse } from "../../server/errors.js";
import { validateWorkspaceImportInput } from "../../server/validators.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(val: unknown): val is string {
  return typeof val === "string" && UUID_REGEX.test(val.trim());
}

/**
 * POST /api/workspace/import
 * Authenticated transactional workspace import endpoint.
 * Copies local projects, tasks, subtasks, tags, and recurrence relationships into Neon PostgreSQL.
 * Enforces server-side idempotency, provenance tracking, duplicate protection, and UUID collision safety.
 */
export default async function handler(req: VercelRequest | Request, res?: VercelResponse) {
  if ((req as any).method !== "POST") {
    if (res) {
      res.setHeader("Allow", "POST");
      return res.status(405).json({
        error: { code: "METHOD_NOT_ALLOWED", message: "Only POST requests are allowed on this endpoint" }
      });
    }
    return new Response(
      JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "Only POST requests are allowed" } }),
      { status: 405, headers: { "Content-Type": "application/json", Allow: "POST" } }
    );
  }

  try {
    // 1. Authenticate user from Clerk session
    const user = await requireAuthUser(req);

    // 2. Extract and validate request body
    const body = (req as any).body;
    const validatedInput = validateWorkspaceImportInput(body);
    const { importId, source, workspace } = validatedInput;

    const db = getDbPool();

    // 3. Execute atomic import transaction
    const result = await db.transaction(async (tx) => {
      // Step A: Idempotency check via workspace_imports
      const [claimed] = await tx
        .insert(schema.workspaceImports)
        .values({
          userId: user.id,
          importId: importId,
          source: source,
          status: "processing",
          taskCount: 0,
          projectCount: 0,
          subtaskCount: 0,
          tagCount: 0,
          remappedProjectCount: 0,
          remappedTaskCount: 0,
          remappedSubtaskCount: 0
        })
        .onConflictDoNothing({ target: [schema.workspaceImports.userId, schema.workspaceImports.importId] })
        .returning();

      if (!claimed) {
        // importId was already submitted for this user
        const [existingImport] = await tx
          .select()
          .from(schema.workspaceImports)
          .where(
            and(
              eq(schema.workspaceImports.userId, user.id),
              eq(schema.workspaceImports.importId, importId)
            )
          )
          .limit(1);

        if (existingImport && existingImport.status === "completed") {
          // Replay cached successful import result
          return {
            importId: existingImport.importId,
            status: "completed",
            idempotent: true,
            taskCount: existingImport.taskCount,
            projectCount: existingImport.projectCount,
            subtaskCount: existingImport.subtaskCount,
            tagCount: existingImport.tagCount,
            imported: {
              projects: existingImport.projectCount,
              tasks: existingImport.taskCount,
              subtasks: existingImport.subtaskCount,
              tags: existingImport.tagCount
            },
            remapped: {
              projects: existingImport.remappedProjectCount,
              tasks: existingImport.remappedTaskCount,
              subtasks: existingImport.remappedSubtaskCount
            }
          };
        }

        throw new ApiError(409, "CONFLICT", "An import with this ID is currently processing. Please wait.");
      }

      // Step B: Query user's existing records by legacy provenance
      const existingUserProjects = await tx
        .select()
        .from(schema.projects)
        .where(
          and(
            eq(schema.projects.userId, user.id),
            eq(schema.projects.legacySource, source),
            isNotNull(schema.projects.legacyId)
          )
        );
      const existingProjectMap = new Map(existingUserProjects.map((p) => [p.legacyId!, p]));

      const existingUserTasks = await tx
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.userId, user.id),
            eq(schema.tasks.legacySource, source),
            isNotNull(schema.tasks.legacyId)
          )
        );
      const existingTaskMap = new Map(existingUserTasks.map((t) => [t.legacyId!, t]));

      // Step C: Check table UUID existence to detect collisions for valid UUIDs
      const proposedProjectUuids = workspace.projects.map((p) => p.id).filter(isValidUuid);
      const existingTableProjects = proposedProjectUuids.length > 0
        ? await tx
            .select({ id: schema.projects.id })
            .from(schema.projects)
            .where(inArray(schema.projects.id, proposedProjectUuids))
        : [];
      const existingTableProjectIdSet = new Set(existingTableProjects.map((p) => p.id));

      const proposedTaskUuids = workspace.tasks.map((t) => t.id).filter(isValidUuid);
      const existingTableTasks = proposedTaskUuids.length > 0
        ? await tx
            .select({ id: schema.tasks.id })
            .from(schema.tasks)
            .where(inArray(schema.tasks.id, proposedTaskUuids))
        : [];
      const existingTableTaskIdSet = new Set(existingTableTasks.map((t) => t.id));

      const proposedSubtaskUuids = workspace.tasks.flatMap((t) => t.subtasks.map((s) => s.id)).filter(isValidUuid);
      const existingTableSubtasks = proposedSubtaskUuids.length > 0
        ? await tx
            .select({ id: schema.subtasks.id })
            .from(schema.subtasks)
            .where(inArray(schema.subtasks.id, proposedSubtaskUuids))
        : [];
      const existingTableSubtaskIdSet = new Set(existingTableSubtasks.map((s) => s.id));

      // Step D: Process Projects
      const projectMap = new Map<string, string>();
      let importedProjects = 0;
      let remappedProjects = 0;

      for (const p of workspace.projects) {
        if (existingProjectMap.has(p.id)) {
          // Provenance match: already imported
          const existingProj = existingProjectMap.get(p.id)!;
          projectMap.set(p.id, existingProj.id);
        } else {
          // New project to insert
          let cloudProjectId: string;
          if (isValidUuid(p.id) && !existingTableProjectIdSet.has(p.id)) {
            cloudProjectId = p.id;
          } else {
            cloudProjectId = crypto.randomUUID();
            remappedProjects++;
          }
          projectMap.set(p.id, cloudProjectId);

          await tx.insert(schema.projects).values({
            id: cloudProjectId,
            userId: user.id,
            name: p.name,
            color: p.color,
            legacySource: source,
            legacyId: p.id,
            version: 1,
            createdAt: p.createdAt || new Date(),
            updatedAt: new Date()
          });
          importedProjects++;
        }
      }

      // Step E: Process Recurrence Series Mapping
      const seriesMap = new Map<string, string>();
      const localSeriesIds = new Set(
        workspace.tasks.map((t) => t.recurrenceSeriesId).filter(Boolean) as string[]
      );
      for (const localSeriesId of localSeriesIds) {
        if (isValidUuid(localSeriesId)) {
          seriesMap.set(localSeriesId, localSeriesId);
        } else {
          seriesMap.set(localSeriesId, crypto.randomUUID());
        }
      }

      // Step F: Process Tasks (Pass 1: Insert tasks, subtasks, tags)
      const taskMap = new Map<string, string>();
      const tasksToUpdateNextOccurrence: { taskId: string; nextLocalId: string }[] = [];

      let importedTasks = 0;
      let remappedTasks = 0;
      let importedSubtasks = 0;
      let remappedSubtasks = 0;
      let importedTags = 0;

      for (const t of workspace.tasks) {
        if (existingTaskMap.has(t.id)) {
          // Provenance match: task already exists in cloud
          const existingTask = existingTaskMap.get(t.id)!;
          taskMap.set(t.id, existingTask.id);
        } else {
          // New task
          let cloudTaskId: string;
          if (isValidUuid(t.id) && !existingTableTaskIdSet.has(t.id)) {
            cloudTaskId = t.id;
          } else {
            cloudTaskId = crypto.randomUUID();
            remappedTasks++;
          }
          taskMap.set(t.id, cloudTaskId);

          const mappedProjectId = t.projectId ? projectMap.get(t.projectId) || null : null;
          const mappedSeriesId = t.recurrenceSeriesId ? seriesMap.get(t.recurrenceSeriesId) || null : null;

          await tx.insert(schema.tasks).values({
            id: cloudTaskId,
            userId: user.id,
            projectId: mappedProjectId,
            title: t.title,
            description: t.description,
            priority: t.priority,
            dueDate: t.dueDate,
            dueTime: t.dueTime,
            completed: t.completed,
            completedAt: t.completedAt,
            notes: t.notes,
            reminder: t.reminder,
            recurrence: t.recurrence,
            recurrenceSeriesId: mappedSeriesId,
            generatedNextOccurrenceId: null, // Populated in Pass 2
            legacySource: source,
            legacyId: t.id,
            version: 1,
            createdAt: t.createdAt || new Date(),
            updatedAt: new Date()
          });
          importedTasks++;

          if (t.generatedNextOccurrenceId) {
            tasksToUpdateNextOccurrence.push({
              taskId: cloudTaskId,
              nextLocalId: t.generatedNextOccurrenceId
            });
          }

          // Insert subtasks for newly imported task
          for (const s of t.subtasks) {
            let cloudSubtaskId: string;
            if (isValidUuid(s.id) && !existingTableSubtaskIdSet.has(s.id)) {
              cloudSubtaskId = s.id;
            } else {
              cloudSubtaskId = crypto.randomUUID();
              remappedSubtasks++;
            }
            await tx.insert(schema.subtasks).values({
              id: cloudSubtaskId,
              taskId: cloudTaskId,
              userId: user.id,
              title: s.title,
              completed: s.completed,
              position: s.position,
              version: 1,
              createdAt: s.createdAt || new Date(),
              updatedAt: new Date()
            });
            importedSubtasks++;
          }

          // Insert tags for newly imported task
          for (const tag of t.tags) {
            await tx
              .insert(schema.taskTags)
              .values({
                taskId: cloudTaskId,
                userId: user.id,
                tag: tag,
                createdAt: new Date()
              })
              .onConflictDoNothing();
            importedTags++;
          }
        }
      }

      // Step G: Pass 2 - Resolve and link generatedNextOccurrenceId
      for (const item of tasksToUpdateNextOccurrence) {
        const mappedNextId = taskMap.get(item.nextLocalId);
        if (mappedNextId) {
          await tx
            .update(schema.tasks)
            .set({ generatedNextOccurrenceId: mappedNextId })
            .where(eq(schema.tasks.id, item.taskId));
        }
      }

      // Step H: Update workspace_imports record to completed
      await tx
        .update(schema.workspaceImports)
        .set({
          status: "completed",
          importedAt: new Date(),
          projectCount: importedProjects,
          taskCount: importedTasks,
          subtaskCount: importedSubtasks,
          tagCount: importedTags,
          remappedProjectCount: remappedProjects,
          remappedTaskCount: remappedTasks,
          remappedSubtaskCount: remappedSubtasks
        })
        .where(
          and(
            eq(schema.workspaceImports.userId, user.id),
            eq(schema.workspaceImports.importId, importId)
          )
        );

      return {
        importId: importId,
        status: "completed",
        idempotent: false,
        taskCount: importedTasks,
        projectCount: importedProjects,
        subtaskCount: importedSubtasks,
        tagCount: importedTags,
        imported: {
          projects: importedProjects,
          tasks: importedTasks,
          subtasks: importedSubtasks,
          tags: importedTags
        },
        remapped: {
          projects: remappedProjects,
          tasks: remappedTasks,
          subtasks: remappedSubtasks
        }
      };
    });

    if (res) {
      return res.status(200).json({ data: result });
    }
    return new Response(JSON.stringify({ data: result }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    const errorRes = createErrorResponse(error);
    if (res) {
      return res.status(errorRes.statusCode).json(errorRes.body);
    }
    return new Response(JSON.stringify(errorRes.body), {
      status: errorRes.statusCode,
      headers: { "Content-Type": "application/json" }
    });
  }
}
