/**
 * Data Serialization Layer for Momentum V2 Backend
 * Converts internal Neon PostgreSQL records (snake_case) to client-ready API DTOs (camelCase)
 * Strips internal secrets and formats timestamps cleanly.
 */
import type { Project, Task, Subtask, UserSettings } from "./schema.js";

export interface SerializedProject {
  id: string;
  name: string;
  color: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function serializeProject(project: Project): SerializedProject {
  return {
    id: project.id,
    name: project.name,
    color: project.color,
    version: project.version,
    createdAt: project.createdAt instanceof Date ? project.createdAt.toISOString() : new Date(project.createdAt).toISOString(),
    updatedAt: project.updatedAt instanceof Date ? project.updatedAt.toISOString() : new Date(project.updatedAt).toISOString()
  };
}

export interface SerializedSubtask {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  position: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function serializeSubtask(subtask: Subtask): SerializedSubtask {
  return {
    id: subtask.id,
    taskId: subtask.taskId,
    title: subtask.title,
    completed: subtask.completed,
    position: subtask.position,
    version: subtask.version,
    createdAt: subtask.createdAt instanceof Date ? subtask.createdAt.toISOString() : new Date(subtask.createdAt).toISOString(),
    updatedAt: subtask.updatedAt instanceof Date ? subtask.updatedAt.toISOString() : new Date(subtask.updatedAt).toISOString()
  };
}

export interface SerializedTask {
  id: string;
  projectId: string | null;
  title: string;
  description: string;
  priority: string;
  dueDate: string | null;
  dueTime: string | null;
  completed: boolean;
  completedAt: string | null;
  notes: string;
  reminder: string | null;
  recurrence: string;
  recurrenceSeriesId: string | null;
  generatedNextOccurrenceId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  subtasks: SerializedSubtask[];
  tags: string[];
}

export function serializeTask(
  task: Task,
  subtasks: Subtask[] = [],
  tags: string[] = []
): SerializedTask {
  return {
    id: task.id,
    projectId: task.projectId ?? null,
    title: task.title,
    description: task.description ?? "",
    priority: task.priority,
    dueDate: task.dueDate ?? null,
    dueTime: task.dueTime ?? null,
    completed: task.completed,
    completedAt: task.completedAt ? (task.completedAt instanceof Date ? task.completedAt.toISOString() : new Date(task.completedAt).toISOString()) : null,
    notes: task.notes ?? "",
    reminder: task.reminder ?? null,
    recurrence: task.recurrence,
    recurrenceSeriesId: task.recurrenceSeriesId ?? null,
    generatedNextOccurrenceId: task.generatedNextOccurrenceId ?? null,
    version: task.version,
    createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : new Date(task.createdAt).toISOString(),
    updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : new Date(task.updatedAt).toISOString(),
    subtasks: subtasks.map(serializeSubtask),
    tags
  };
}

export interface SerializedUserSettings {
  theme: string;
  sortPreference: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function serializeUserSettings(settings: UserSettings): SerializedUserSettings {
  return {
    theme: settings.theme,
    sortPreference: settings.sortPreference,
    version: settings.version,
    createdAt: settings.createdAt instanceof Date ? settings.createdAt.toISOString() : new Date(settings.createdAt).toISOString(),
    updatedAt: settings.updatedAt instanceof Date ? settings.updatedAt.toISOString() : new Date(settings.updatedAt).toISOString()
  };
}
