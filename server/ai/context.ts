/**
 * Momentum Intelligence — Context Preparation & Data Minimization
 *
 * Builds minimal, sanitized AI context objects for each capability.
 * Enforces strict data minimization — only sends what is necessary.
 *
 * NEVER includes:
 *   - Clerk JWT or auth tokens
 *   - authProviderId
 *   - email addresses
 *   - database connection strings
 *   - import provenance metadata
 *   - workspace dump (entire workspace)
 *
 * Database UUIDs are converted to temporary neutral references before
 * being passed to the model. The server resolves them back afterward.
 */

import type { Task, Project } from "../schema.js";

// ---------------------------------------------------------------------------
// Types for sanitized AI context objects
// ---------------------------------------------------------------------------

export interface AITaskContext {
  ref: string;         // "t1", "t2" ... (temp ID, not DB UUID)
  title: string;
  priority: string;
  dueDate: string | null;
  dueTime: string | null;
  projectName: string | null;
  tags: string[];
  completed: boolean;
  overdue: boolean;
}

export interface AIProjectContext {
  ref: string;         // "p1", "p2" ... (temp ID, not DB UUID)
  name: string;
}

export interface TempRefMap {
  tasks: Record<string, string>;    // { "t1" -> actual UUID, ... }
  projects: Record<string, string>; // { "p1" -> actual UUID, ... }
}

// ---------------------------------------------------------------------------
// Escape user content for prompt injection prevention
// ---------------------------------------------------------------------------

export function escapeUserContent(text: string): string {
  if (!text) return "";
  // XML-escape: prevents task titles/descriptions from being interpreted as XML/HTML
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .slice(0, 500); // Hard cap on any single user-content field
}

// ---------------------------------------------------------------------------
// Build sanitized task context
// ---------------------------------------------------------------------------

export function buildTaskContextList(
  tasks: Task[],
  projects: Project[],
  maxTasks: number,
  today: string
): { contexts: AITaskContext[]; refMap: TempRefMap } {
  const projectMap = new Map<string, string>();
  for (const p of projects) {
    projectMap.set(p.id, p.name);
  }

  const refMap: TempRefMap = { tasks: {}, projects: {} };
  const contexts: AITaskContext[] = [];
  let counter = 1;

  for (const task of tasks.slice(0, maxTasks)) {
    const ref = `t${counter++}`;
    refMap.tasks[ref] = task.id;

    contexts.push({
      ref,
      title: escapeUserContent(task.title),
      priority: task.priority,
      dueDate: task.dueDate ?? null,
      dueTime: task.dueTime ?? null,
      projectName: task.projectId ? escapeUserContent(projectMap.get(task.projectId) ?? "") || null : null,
      tags: (task as any).tags ?? [],
      completed: task.completed,
      overdue: !task.completed && !!task.dueDate && task.dueDate < today
    });
  }

  return { contexts, refMap };
}

// ---------------------------------------------------------------------------
// Build context for Plan My Day
// ---------------------------------------------------------------------------

export function buildPlanDayContext(
  tasks: Task[],
  projects: Project[],
  maxTasks: number,
  today: string
): { contexts: AITaskContext[]; refMap: TempRefMap } {
  // Only include: due today, overdue, high priority incomplete tasks
  const relevant = tasks.filter(t =>
    !t.completed && (
      t.dueDate === today ||
      (t.dueDate && t.dueDate < today) ||
      t.priority === "high"
    )
  );

  return buildTaskContextList(relevant, projects, maxTasks, today);
}

// ---------------------------------------------------------------------------
// Build context for Break Down Task
// ---------------------------------------------------------------------------

export interface BreakDownContext {
  title: string;
  description: string;
  dueDate: string | null;
  projectName: string | null;
}

export function buildBreakDownContext(
  task: Task,
  projects: Project[]
): BreakDownContext {
  const projectName = task.projectId
    ? projects.find(p => p.id === task.projectId)?.name ?? null
    : null;

  return {
    title: escapeUserContent(task.title),
    description: escapeUserContent(task.description || ""),
    dueDate: task.dueDate ?? null,
    projectName: projectName ? escapeUserContent(projectName) : null
  };
}

// ---------------------------------------------------------------------------
// Build context for Briefing
// ---------------------------------------------------------------------------

export interface BriefingStats {
  dueToday: number;
  overdue: number;
  highPriority: number;
  totalOpen: number;
  topTaskTitle: string | null;
  dueTomorrow: number;
}

export function computeBriefingStats(
  tasks: Task[],
  today: string,
  tomorrow: string
): BriefingStats {
  const open = tasks.filter(t => !t.completed);
  const dueToday = open.filter(t => t.dueDate === today).length;
  const overdue = open.filter(t => t.dueDate && t.dueDate < today).length;
  const highPriority = open.filter(t => t.priority === "high").length;
  const dueTomorrow = open.filter(t => t.dueDate === tomorrow).length;

  // Most important = highest priority + earliest due
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const sorted = [...open]
    .filter(t => t.dueDate && t.dueDate <= tomorrow)
    .sort((a, b) => {
      const pa = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 1;
      const pb = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 1;
      if (pa !== pb) return pa - pb;
      return (a.dueDate ?? "9999") < (b.dueDate ?? "9999") ? -1 : 1;
    });

  return {
    dueToday,
    overdue,
    highPriority,
    totalOpen: open.length,
    topTaskTitle: sorted[0] ? escapeUserContent(sorted[0].title) : null,
    dueTomorrow
  };
}

// ---------------------------------------------------------------------------
// Build context for Weekly Review
// ---------------------------------------------------------------------------

export interface WeeklyStats {
  completed: number;
  created: number;
  stillOpen: number;
  overdue: number;
  topProjects: Array<{ name: string; completed: number }>;
  mostProductiveDay: string | null;
}

export function computeWeeklyStats(
  tasks: Task[],
  projects: Project[],
  weekStart: string,
  weekEnd: string,
  today: string
): WeeklyStats {
  const projectMap = new Map<string, string>();
  for (const p of projects) projectMap.set(p.id, p.name);

  const projectCompletionMap = new Map<string, number>();
  const dayCompletionMap = new Map<string, number>();

  let completed = 0;
  let created = 0;
  let stillOpen = 0;
  let overdue = 0;

  for (const t of tasks) {
    const createdAt = t.createdAt instanceof Date
      ? t.createdAt.toISOString().slice(0, 10)
      : String(t.createdAt).slice(0, 10);

    if (createdAt >= weekStart && createdAt <= weekEnd) {
      created++;
    }

    if (t.completed && t.completedAt) {
      const completedDate = t.completedAt instanceof Date
        ? t.completedAt.toISOString().slice(0, 10)
        : String(t.completedAt).slice(0, 10);

      if (completedDate >= weekStart && completedDate <= weekEnd) {
        completed++;

        // Track by project
        if (t.projectId && projectMap.has(t.projectId)) {
          const name = projectMap.get(t.projectId)!;
          projectCompletionMap.set(name, (projectCompletionMap.get(name) ?? 0) + 1);
        }

        // Track by day of week
        const dayKey = new Date(completedDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
        dayCompletionMap.set(dayKey, (dayCompletionMap.get(dayKey) ?? 0) + 1);
      }
    }

    if (!t.completed) {
      stillOpen++;
      if (t.dueDate && t.dueDate < today) overdue++;
    }
  }

  // Top 3 projects by completions this week
  const topProjects = [...projectCompletionMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({ name: escapeUserContent(name), completed: count }));

  // Most productive day
  let mostProductiveDay: string | null = null;
  let maxDay = 0;
  for (const [day, count] of dayCompletionMap.entries()) {
    if (count > maxDay) {
      maxDay = count;
      mostProductiveDay = day;
    }
  }

  return { completed, created, stillOpen, overdue, topProjects, mostProductiveDay };
}

// ---------------------------------------------------------------------------
// Date utilities (timezone-aware)
// ---------------------------------------------------------------------------

export function getTodayString(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function getTomorrowString(today: string): string {
  const d = new Date(today + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function getWeekBounds(today: string): { weekStart: string; weekEnd: string } {
  const d = new Date(today + "T00:00:00");
  const dayOfWeek = d.getDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const start = new Date(d);
  start.setDate(d.getDate() + mondayOffset);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  return {
    weekStart: start.toISOString().slice(0, 10),
    weekEnd: end.toISOString().slice(0, 10)
  };
}
