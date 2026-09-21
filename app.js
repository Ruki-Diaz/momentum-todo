/**
 * Momentum Todo V2 — Core Application & Ambient WebGL Engine
 * Checkpoint 3: Power Features
 * Pure Vanilla JavaScript (ES6+) — Offline-First & Cloud-Ready
 */

// ==========================================================================
// 1. CONSTANTS & DEFAULT DATA
// ==========================================================================
const STORAGE_KEY = "momentum-todos-v1";
const STORAGE_PROJECTS_KEY = "momentum-projects-v1";
const STORAGE_THEME_KEY = "momentum-theme";
const STORAGE_SORT_KEY = "momentum-sort";

const DEFAULT_PROJECTS = [
  { id: "e1b2c3d4-0001-4000-8000-000000000001", name: "Work", color: "#f08352", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "e1b2c3d4-0002-4000-8000-000000000002", name: "Personal", color: "#4e9d75", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "e1b2c3d4-0003-4000-8000-000000000003", name: "University", color: "#d7a34b", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "e1b2c3d4-0004-4000-8000-000000000004", name: "Finance", color: "#a569bd", createdAt: "2026-01-01T00:00:00.000Z" }
];

const PROJECT_COLORS = [
  "#f08352", "#4e9d75", "#d7a34b", "#a569bd", "#3498db", "#e74c3c"
];

// ==========================================================================
// 2. DATA UTILITIES & NORMALIZATION (Schema Migration & Idempotency)
// ==========================================================================
function normalizeTag(tag) {
  if (typeof tag !== "string") return "";
  return tag.trim().replace(/^#/, "").toLowerCase();
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const set = new Set();
  const result = [];
  for (const t of tags) {
    const norm = normalizeTag(t);
    if (norm && !set.has(norm)) {
      set.add(norm);
      result.push(norm);
    }
  }
  return result;
}

function normalizeProject(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
    name: typeof raw.name === "string" ? raw.name.trim() : "Untitled Project",
    color: typeof raw.color === "string" ? raw.color : "#f08352",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString()
  };
}

function resolveProjectId(rawProjectVal, projects) {
  if (!rawProjectVal) return null;
  const str = String(rawProjectVal).trim();
  if (!str) return null;

  // Direct match by ID
  const byId = projects.find((p) => p.id === str);
  if (byId) return byId.id;

  // Case-insensitive match by name or legacy slug
  const byNameOrSlug = projects.find(
    (p) => p.name.toLowerCase() === str.toLowerCase() || p.id.toLowerCase() === str.toLowerCase()
  );
  if (byNameOrSlug) return byNameOrSlug.id;

  // Unknown project -> Inbox (null)
  return null;
}

function normalizeSubtask(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
    title: typeof raw.title === "string" ? raw.title.trim() : "",
    completed: Boolean(raw.completed),
    createdAt: typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : new Date().toISOString()
  };
}

function normalizeTodo(raw, projects = DEFAULT_PROJECTS) {
  if (!raw || typeof raw !== "object") return null;

  const rawProject = raw.projectId !== undefined ? raw.projectId : raw.project;
  const projectId = resolveProjectId(rawProject, projects);

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
    title: typeof raw.title === "string" ? raw.title.trim() : "",
    description: typeof raw.description === "string" ? raw.description : "",
    priority: ["high", "medium", "low"].includes(raw.priority) ? raw.priority : "medium",
    dueDate: typeof raw.dueDate === "string" ? raw.dueDate : "",
    dueTime: typeof raw.dueTime === "string" ? raw.dueTime : "",
    projectId: projectId, // canonical UUID or null
    tags: normalizeTags(raw.tags),
    completed: Boolean(raw.completed),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    completedAt: raw.completed
      ? typeof raw.completedAt === "string" && raw.completedAt
        ? raw.completedAt
        : raw.createdAt || new Date().toISOString()
      : null,
    subtasks: Array.isArray(raw.subtasks)
      ? raw.subtasks.map(normalizeSubtask).filter(Boolean)
      : [],
    notes: typeof raw.notes === "string" ? raw.notes : "",
    reminder: typeof raw.reminder === "string" && raw.reminder ? raw.reminder : null,
    recurrence: ["none", "daily", "weekdays", "weekly", "monthly"].includes(raw.recurrence)
      ? raw.recurrence
      : "none",
    recurrenceSeriesId: typeof raw.recurrenceSeriesId === "string" && raw.recurrenceSeriesId ? raw.recurrenceSeriesId : null,
    generatedNextOccurrenceId: typeof raw.generatedNextOccurrenceId === "string" && raw.generatedNextOccurrenceId ? raw.generatedNextOccurrenceId : null
  };
}

function duplicateTodo(todo) {
  return {
    ...JSON.parse(JSON.stringify(todo)),
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    completed: false,
    completedAt: null,
    recurrenceSeriesId: null,
    generatedNextOccurrenceId: null,
    subtasks: (todo.subtasks || []).map((s) => ({
      id: crypto.randomUUID(),
      title: s.title,
      completed: false,
      createdAt: new Date().toISOString()
    }))
  };
}

// ==========================================================================
// 3. RECURRENCE ENGINE DATE CALCULATIONS
// ==========================================================================
function calculateNextDueDate(currentDueDateStr, recurrence) {
  if (!currentDueDateStr || recurrence === "none") return null;

  const [year, month, day] = currentDueDateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  if (recurrence === "daily") {
    date.setDate(date.getDate() + 1);
  } else if (recurrence === "weekdays") {
    const dayOfWeek = date.getDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
    if (dayOfWeek === 5) {
      // Friday -> Monday (+3 days)
      date.setDate(date.getDate() + 3);
    } else if (dayOfWeek === 6) {
      // Saturday -> Monday (+2 days)
      date.setDate(date.getDate() + 2);
    } else {
      date.setDate(date.getDate() + 1);
    }
  } else if (recurrence === "weekly") {
    date.setDate(date.getDate() + 7);
  } else if (recurrence === "monthly") {
    const targetMonth = date.getMonth() + 1;
    date.setMonth(targetMonth);
    // Month-end edge cases: if month wrapped around (e.g. Jan 31 -> March 3), clamp back to last day of month
    if (date.getMonth() !== targetMonth % 12) {
      date.setDate(0);
    }
  }

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ==========================================================================
// 4. DATASTORE ABSTRACTION LAYER (Centralized Storage & Cloud-Sync Ready)
// ==========================================================================
const DataStore = {
  getProjects() {
    try {
      const raw = localStorage.getItem(STORAGE_PROJECTS_KEY);
      if (!raw) return [...DEFAULT_PROJECTS];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_PROJECTS];
      return parsed.map(normalizeProject).filter(Boolean);
    } catch {
      return [...DEFAULT_PROJECTS];
    }
  },

  saveProjects(projects) {
    try {
      localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(projects));
    } catch (err) {
      console.error("Failed to persist projects to localStorage", err);
    }
  },

  getTodos(projects = null) {
    try {
      const activeProjects = projects || this.getProjects();
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((t) => normalizeTodo(t, activeProjects)).filter(Boolean);
    } catch (err) {
      console.warn("Could not parse existing todos from storage", err);
      return [];
    }
  },

  saveTodos(todos) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
    } catch (err) {
      console.error("Failed to persist todos to localStorage", err);
    }
  },

  getTheme() {
    try {
      return localStorage.getItem(STORAGE_THEME_KEY) || "dark";
    } catch {
      return "dark";
    }
  },

  saveTheme(theme) {
    try {
      localStorage.setItem(STORAGE_THEME_KEY, theme);
    } catch (err) {
      console.error("Failed to persist theme preference", err);
    }
  },

  getSortPreference() {
    try {
      return localStorage.getItem(STORAGE_SORT_KEY) || "smart";
    } catch {
      return "smart";
    }
  },

  saveSortPreference(sort) {
    try {
      localStorage.setItem(STORAGE_SORT_KEY, sort);
    } catch (err) {
      console.error("Failed to persist sort preference", err);
    }
  },

  deleteProject(projectId) {
    const deletedProject = state.projects.find((p) => p.id === projectId);
    const nextProjects = state.projects.filter((p) => p.id !== projectId);
    const affectedTodoIds = state.todos.filter((t) => t.projectId === projectId).map((t) => t.id);
    const nextTodos = state.todos.map((t) =>
      t.projectId === projectId ? { ...t, projectId: null } : t
    );

    if (deletedProject) {
      state.undoManager.push({
        type: "DELETE_PROJECT",
        project: deletedProject,
        affectedTodoIds
      });
    }

    state.projects = nextProjects;
    state.todos = nextTodos;
    this.saveProjects(nextProjects);
    this.saveTodos(nextTodos);
  },

  exportData() {
    const backup = {
      app: "Momentum",
      version: "2.0.0",
      exportedAt: new Date().toISOString(),
      todos: state.todos,
      projects: state.projects
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateStr = getLocalDateString();
    a.href = url;
    a.download = `momentum-backup-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};

// ==========================================================================
// 5. STRUCTURED UNDO MANAGER
// ==========================================================================
class UndoManager {
  constructor() {
    this.stack = [];
  }

  push(action) {
    this.stack.push({
      ...action,
      timestamp: Date.now()
    });
    if (this.stack.length > 20) {
      this.stack.shift();
    }
  }

  pop() {
    return this.stack.pop();
  }

  hasUndo() {
    return this.stack.length > 0;
  }

  undo() {
    const action = this.pop();
    if (!action) return false;

    if (action.type === "DELETE_TODO") {
      const { todo, index } = action;
      const nextTodos = [...state.todos];
      const insertAt = typeof index === "number" && index >= 0 && index <= nextTodos.length ? index : 0;
      nextTodos.splice(insertAt, 0, todo);
      state.todos = nextTodos;
      DataStore.saveTodos(state.todos);
      render();
      showToast(`Restored "${todo.title}"`, 2200);
      return true;
    } else if (action.type === "COMPLETE_TODO") {
      const { todoId, previousCompleted, previousCompletedAt, generatedOccurrenceId } = action;
      state.todos = state.todos
        .filter((t) => t.id !== generatedOccurrenceId)
        .map((t) => {
          if (t.id === todoId) {
            return {
              ...t,
              completed: previousCompleted,
              completedAt: previousCompletedAt,
              generatedNextOccurrenceId: null
            };
          }
          return t;
        });
      DataStore.saveTodos(state.todos);
      render();
      showToast("Completion undone", 2000);
      return true;
    } else if (action.type === "DELETE_PROJECT") {
      const { project, affectedTodoIds } = action;
      state.projects.push(project);
      state.todos = state.todos.map((t) =>
        affectedTodoIds.includes(t.id) ? { ...t, projectId: project.id } : t
      );
      DataStore.saveProjects(state.projects);
      DataStore.saveTodos(state.todos);
      render();
      showToast(`Restored project "${project.name}"`, 2500);
      return true;
    } else if (action.type === "CLEAR_COMPLETED") {
      const { clearedTodos } = action;
      state.todos = [...clearedTodos, ...state.todos];
      DataStore.saveTodos(state.todos);
      render();
      showToast(`Restored ${clearedTodos.length} completed task${clearedTodos.length === 1 ? "" : "s"}`, 2500);
      return true;
    }

    return false;
  }
}

// ==========================================================================
// 6. DOM ELEMENTS
// ==========================================================================
const appSidebar = document.querySelector("#appSidebar");
const sidebarOverlay = document.querySelector("#sidebarOverlay");
const mobileMenuBtn = document.querySelector("#mobileMenuBtn");
const mobileMenuMoreBtn = document.querySelector("#mobileMenuMoreBtn");
const sidebarCloseBtn = document.querySelector("#sidebarCloseBtn");
const themeToggleBtn = document.querySelector("#themeToggleBtn");
const mobileThemeToggleBtn = document.querySelector("#mobileThemeToggleBtn");
const themeLabel = document.querySelector("#themeLabel");

const userProfileWrap = document.querySelector(".user-profile-wrap");
const userProfileBtn = document.querySelector("#userProfileBtn");
const userAccountMenu = document.querySelector("#userAccountMenu");
const menuSignInBtn = document.querySelector("#menuSignInBtn");
const menuManageAccountBtn = document.querySelector("#menuManageAccountBtn");
const menuToggleThemeBtn = document.querySelector("#menuToggleThemeBtn");
const menuExportDataBtn = document.querySelector("#menuExportDataBtn");
const menuClearCompletedBtn = document.querySelector("#menuClearCompletedBtn");
const menuSignOutBtn = document.querySelector("#menuSignOutBtn");
const accountMenuHeaderTitle = document.querySelector("#accountMenuHeaderTitle");
const accountMenuHeaderSub = document.querySelector("#accountMenuHeaderSub");
const accountMenuBadge = document.querySelector("#accountMenuBadge");

// Authentication Modal Elements (Clerk)
const authModalOverlay = document.querySelector("#authModalOverlay");
const authModal = document.querySelector("#authModal");
const closeAuthModalBtn = document.querySelector("#closeAuthModalBtn");
const clerkAuthMount = document.querySelector("#clerkAuthMount");
const authLoadingSpinner = document.querySelector("#authLoadingSpinner");


const heroSection = document.querySelector("#heroSection");
const heroDate = document.querySelector("#heroDate");
const heroGreetingText = document.querySelector("#heroGreetingText");
const heroTitle = document.querySelector("#heroTitle");
const heroSubtitle = document.querySelector("#heroSubtitle");

// Clickable Stat Cards
const cardToday = document.querySelector("#cardToday");
const cardOverdue = document.querySelector("#cardOverdue");
const cardCompleted = document.querySelector("#cardCompleted");
const cardStreak = document.querySelector("#cardStreak");

const statTodayCount = document.querySelector("#statTodayCount");
const statOverdueCount = document.querySelector("#statOverdueCount");
const statCompletedCount = document.querySelector("#statCompletedCount");
const statStreakCount = document.querySelector("#statStreakCount");

const navCountToday = document.querySelector("#navCountToday");
const navCountInbox = document.querySelector("#navCountInbox");
const navCountUpcoming = document.querySelector("#navCountUpcoming");
const navCountCompleted = document.querySelector("#navCountCompleted");
const projectsNavList = document.querySelector("#projectsNavList");
const tagsNavList = document.querySelector("#tagsNavList");
const addProjectBtn = document.querySelector("#addProjectBtn");

// Desktop Task Composer (Smart 2-State)
const composerPanel = document.querySelector("#composerPanel");
const todoForm = document.querySelector("#todoForm");
const todoInput = document.querySelector("#todoInput");
const priorityInput = document.querySelector("#priorityInput");
const dueDateInput = document.querySelector("#dueDateInput");
const dueTimeInput = document.querySelector("#dueTimeInput");
const projectInput = document.querySelector("#projectInput");
const tagsInput = document.querySelector("#tagsInput");
const composerOptionsRow = document.querySelector("#composerOptionsRow");

// Mobile Bottom Sheet Task Composer
const mobileAddBtn = document.querySelector("#mobileAddBtn");
const mobileComposerSheet = document.querySelector("#mobileComposerSheet");
const bottomSheetBackdrop = document.querySelector("#bottomSheetBackdrop");
const closeBottomSheetBtn = document.querySelector("#closeBottomSheetBtn");
const mobileTodoForm = document.querySelector("#mobileTodoForm");
const mobileTodoInput = document.querySelector("#mobileTodoInput");
const mobilePriorityInput = document.querySelector("#mobilePriorityInput");
const mobileDueDateInput = document.querySelector("#mobileDueDateInput");
const mobileDueTimeInput = document.querySelector("#mobileDueTimeInput");
const mobileProjectInput = document.querySelector("#mobileProjectInput");
const mobileTagsInput = document.querySelector("#mobileTagsInput");

const controlsPanel = document.querySelector(".controls-panel");
const listPanel = document.querySelector(".list-panel");
const searchInput = document.querySelector("#searchInput");
const sortSelect = document.querySelector("#sortSelect");
const clearCompletedBtn = document.querySelector("#clearCompletedBtn");
const filterButtons = document.querySelectorAll(".filter-chip");
const navItems = document.querySelectorAll(".nav-item, .mobile-nav-btn:not(#mobileAddBtn):not(#mobileMenuMoreBtn)");

const sectionHeader = document.querySelector("#sectionHeader");
const sectionSubheader = document.querySelector("#sectionSubheader");
const summaryText = document.querySelector("#summaryText");
const todoList = document.querySelector("#todoList");
const emptyStateTemplate = document.querySelector("#emptyStateTemplate");

// Full Calendar Elements
const calendarViewSection = document.querySelector("#calendarViewSection");
const calPrevMonthBtn = document.querySelector("#calPrevMonthBtn");
const calNextMonthBtn = document.querySelector("#calNextMonthBtn");
const calCurrentMonthLabel = document.querySelector("#calCurrentMonthLabel");
const calTodayBtn = document.querySelector("#calTodayBtn");
const calendarMonthGrid = document.querySelector("#calendarMonthGrid");
const mobileCalDateStrip = document.querySelector("#mobileCalDateStrip");
const mobileAgendaDateTitle = document.querySelector("#mobileAgendaDateTitle");
const mobileAgendaList = document.querySelector("#mobileAgendaList");

// Secondary Desktop Rail Elements
const weeklyPercent = document.querySelector("#weeklyPercent");
const weeklyProgressBar = document.querySelector("#weeklyProgressBar");
const weeklySummary = document.querySelector("#weeklySummary");
const miniCalendarMonth = document.querySelector("#miniCalendarMonth");
const miniCalendarToday = document.querySelector("#miniCalendarToday");
const miniCalendarGrid = document.querySelector("#miniCalendarGrid");
const upNextCount = document.querySelector("#upNextCount");
const upNextList = document.querySelector("#upNextList");
const projectsSnapshotList = document.querySelector("#projectsSnapshotList");

const toastContainer = document.querySelector("#toastContainer");

// Task Details Slide-Over Drawer Elements
const drawerOverlay = document.querySelector("#drawerOverlay");
const taskDetailsDrawer = document.querySelector("#taskDetailsDrawer");
const drawerCloseBtn = document.querySelector("#drawerCloseBtn");
const drawerToggleStatusBtn = document.querySelector("#drawerToggleStatusBtn");
const drawerStatusText = document.querySelector("#drawerStatusText");
const drawerSaveStatus = document.querySelector("#drawerSaveStatus");
const drawerDuplicateBtn = document.querySelector("#drawerDuplicateBtn");
const drawerDeleteBtn = document.querySelector("#drawerDeleteBtn");
const drawerTitleInput = document.querySelector("#drawerTitleInput");
const drawerDescInput = document.querySelector("#drawerDescInput");
const drawerPriorityInput = document.querySelector("#drawerPriorityInput");
const drawerProjectInput = document.querySelector("#drawerProjectInput");
const drawerDueDateInput = document.querySelector("#drawerDueDateInput");
const drawerDueTimeInput = document.querySelector("#drawerDueTimeInput");
const drawerRecurrenceInput = document.querySelector("#drawerRecurrenceInput");
const drawerReminderInput = document.querySelector("#drawerReminderInput");
const drawerTagsList = document.querySelector("#drawerTagsList");
const drawerTagsInput = document.querySelector("#drawerTagsInput");
const drawerSubtasksProgressText = document.querySelector("#drawerSubtasksProgressText");
const drawerSubtaskProgressBar = document.querySelector("#drawerSubtaskProgressBar");
const drawerSubtaskList = document.querySelector("#drawerSubtaskList");
const drawerAddSubtaskForm = document.querySelector("#drawerAddSubtaskForm");
const newSubtaskInput = document.querySelector("#newSubtaskInput");
const drawerNotesInput = document.querySelector("#drawerNotesInput");
const drawerCreatedAtLabel = document.querySelector("#drawerCreatedAtLabel");
const drawerCompletedAtLabel = document.querySelector("#drawerCompletedAtLabel");

// Project Modal Elements
const projectModalOverlay = document.querySelector("#projectModalOverlay");
const projectModal = document.querySelector("#projectModal");
const projectModalTitle = document.querySelector("#projectModalTitle");
const closeProjectModalBtn = document.querySelector("#closeProjectModalBtn");
const cancelProjectModalBtn = document.querySelector("#cancelProjectModalBtn");
const projectModalForm = document.querySelector("#projectModalForm");
const projectModalEditId = document.querySelector("#projectModalEditId");
const projectNameInput = document.querySelector("#projectNameInput");
const projectColorPalette = document.querySelector("#projectColorPalette");
const deleteProjectBtn = document.querySelector("#deleteProjectBtn");

// Task Context Menu Popover Elements
const taskContextMenu = document.querySelector("#taskContextMenu");
const ctxOpenDetails = document.querySelector("#ctxOpenDetails");
const ctxDuplicate = document.querySelector("#ctxDuplicate");
const ctxProjectSubmenu = document.querySelector("#ctxProjectSubmenu");
const ctxDelete = document.querySelector("#ctxDelete");

// Command Palette Modal Elements (Cmd+K / Ctrl+K)
const commandPaletteOverlay = document.querySelector("#commandPaletteOverlay");
const commandPaletteModal = document.querySelector("#commandPaletteModal");
const cmdPaletteInput = document.querySelector("#cmdPaletteInput");
const cmdPaletteResults = document.querySelector("#cmdPaletteResults");

// Keyboard Shortcuts Modal Elements (?)
const shortcutsModalOverlay = document.querySelector("#shortcutsModalOverlay");
const closeShortcutsModalBtn = document.querySelector("#closeShortcutsModalBtn");

// ==========================================================================
// 7. APPLICATION STATE
// ==========================================================================
const initialProjects = DataStore.getProjects();
const initialNow = new Date();

let state = {
  currentView: "today", // 'today' | 'inbox' | 'upcoming' | 'calendar' | 'calendar:<YYYY-MM-DD>' | 'completed' | 'overdue' | 'project:<id>' | 'tag:<tag>'
  filter: "all",        // 'all' | 'open' | 'done'
  sort: DataStore.getSortPreference(), // 'smart' | 'dueDate' | 'priority' | 'newest' | 'oldest'
  search: "",
  theme: DataStore.getTheme(),
  projects: initialProjects,
  todos: DataStore.getTodos(initialProjects),
  activeDrawerTodoId: null,
  activeContextMenuTodoId: null,
  completingTodoIds: new Set(),
  lastFocusedElement: null,

  // Calendar State
  calendarDate: { year: initialNow.getFullYear(), month: initialNow.getMonth() }, // 0-indexed month
  selectedCalendarDate: getLocalDateString(initialNow),

  // Command Palette State
  cmdPaletteSelectedIndex: 0,
  cmdPaletteItems: [],

  // Undo System
  undoManager: new UndoManager(),

  // Reminder Tracking
  triggeredReminders: new Set()
};

// ==========================================================================
// 8. TOAST NOTIFICATION & UNDO SYSTEM
// ==========================================================================
function showToast(message, duration = 3000, undoCallback = null) {
  if (!toastContainer) return;

  const toast = document.createElement("div");
  toast.className = "toast";

  const msgSpan = document.createElement("span");
  msgSpan.textContent = message;
  toast.appendChild(msgSpan);

  if (undoCallback) {
    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "toast-undo-btn";
    undoBtn.textContent = "Undo";
    undoBtn.addEventListener("click", () => {
      undoCallback();
      toast.classList.add("toast-fade-out");
      setTimeout(() => {
        if (toast.parentElement) toast.remove();
      }, 200);
    });
    toast.appendChild(undoBtn);
  }

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-fade-out");
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 240);
  }, duration);
}

// ==========================================================================
// 9. THEME MANAGEMENT
// ==========================================================================
function applyTheme(theme) {
  state.theme = theme;
  DataStore.saveTheme(theme);

  let activeTheme = theme;
  if (theme === "system") {
    activeTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  document.documentElement.setAttribute("data-theme", activeTheme);
  if (themeLabel) {
    themeLabel.textContent = capitalize(theme);
  }
}

function toggleTheme() {
  const nextTheme = state.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  showToast(`Switched to ${capitalize(nextTheme)} mode`, 2000);
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  if (state.theme === "system") {
    document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
  }
});

// ==========================================================================
// 10. DATE & TIME UTILITIES
// ==========================================================================
function getLocalDateString(dateObj = new Date()) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTomorrowDateString() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return getLocalDateString(tomorrow);
}

function getFormattedHeaderDate() {
  const now = new Date();
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(now);
  const day = now.getDate();
  const month = new Intl.DateTimeFormat(undefined, { month: "long" }).format(now);
  return `${weekday}, ${day} ${month}`.toUpperCase();
}

function isOverdue(todo) {
  if (!todo.dueDate || todo.completed) return false;
  return todo.dueDate < getLocalDateString();
}

function isToday(todo) {
  return todo.dueDate === getLocalDateString();
}

function isUpcoming(todo) {
  if (!todo.dueDate || todo.completed) return false;
  return todo.dueDate > getLocalDateString();
}

function formatDueDate(dueDate, dueTime) {
  if (!dueDate) return "";

  const todayStr = getLocalDateString();
  const tomorrowStr = getTomorrowDateString();

  let dateLabel = "";
  if (dueDate === todayStr) {
    dateLabel = "Today";
  } else if (dueDate === tomorrowStr) {
    dateLabel = "Tomorrow";
  } else {
    const [year, month, day] = dueDate.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    dateLabel = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined
    }).format(date);
  }

  if (dueTime) {
    const [hh, mm] = dueTime.split(":");
    const hour = parseInt(hh, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const formattedHour = hour % 12 || 12;
    dateLabel += `, ${formattedHour}:${mm} ${ampm}`;
  }

  return dateLabel;
}

function formatTimestamp(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(d);
  } catch {
    return isoStr;
  }
}

function capitalize(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// ==========================================================================
// 11. STREAK & STATS CALCULATIONS
// ==========================================================================
function calculateStreak(completedTodos) {
  const completionDays = new Set(
    completedTodos
      .filter((todo) => todo.completedAt)
      .map((todo) => todo.completedAt.slice(0, 10))
  );

  let streak = 0;
  const cursor = new Date();

  const todayStr = getLocalDateString(cursor);
  if (!completionDays.has(todayStr)) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (completionDays.has(getLocalDateString(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

// ==========================================================================
// 12. ADVANCED SORTING ENGINE (Non-Mutating & Deterministic)
// ==========================================================================
function sortTodos(todos, mode = state.sort) {
  const list = [...todos];

  return list.sort((a, b) => {
    if (mode === "smart") {
      // 1. Incomplete before completed
      if (a.completed !== b.completed) {
        return Number(a.completed) - Number(b.completed);
      }
      // 2. Overdue first
      const aOverdue = isOverdue(a);
      const bOverdue = isOverdue(b);
      if (aOverdue !== bOverdue) {
        return aOverdue ? -1 : 1;
      }
      // 3. Priority: high (0) > medium (1) > low (2)
      const pRank = { high: 0, medium: 1, low: 2 };
      if (pRank[a.priority] !== pRank[b.priority]) {
        return pRank[a.priority] - pRank[b.priority];
      }
      // 4. Nearest due date
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
        return a.dueDate.localeCompare(b.dueDate);
      }
      if (a.dueDate && !b.dueDate) return -1;
      if (!a.dueDate && b.dueDate) return 1;
    } else if (mode === "dueDate") {
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
        return a.dueDate.localeCompare(b.dueDate);
      }
      if (a.dueDate && !b.dueDate) return -1;
      if (!a.dueDate && b.dueDate) return 1;
    } else if (mode === "priority") {
      const pRank = { high: 0, medium: 1, low: 2 };
      if (pRank[a.priority] !== pRank[b.priority]) {
        return pRank[a.priority] - pRank[b.priority];
      }
    } else if (mode === "newest") {
      const cmp = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (cmp !== 0) return cmp;
    } else if (mode === "oldest") {
      const cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (cmp !== 0) return cmp;
    }

    // Deterministic tie-breakers
    const createdCmp = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (createdCmp !== 0) return createdCmp;
    return a.id.localeCompare(b.id);
  });
}

// ==========================================================================
// 13. SMART 2-STATE TASK COMPOSER
// ==========================================================================
function expandComposer() {
  if (composerPanel) {
    composerPanel.classList.add("is-expanded");
  }
}

function collapseComposer() {
  if (composerPanel) {
    composerPanel.classList.remove("is-expanded");
  }
}

function setupComposerInteractions() {
  if (!todoInput || !composerPanel) return;

  todoInput.addEventListener("focus", expandComposer);
  todoInput.addEventListener("input", expandComposer);
  if (composerOptionsRow) {
    composerOptionsRow.addEventListener("click", expandComposer);
  }

  document.addEventListener("click", (e) => {
    if (!composerPanel.contains(e.target)) {
      const hasText = todoInput.value.trim().length > 0;
      const hasTags = tagsInput && tagsInput.value.trim().length > 0;
      const hasTime = dueTimeInput && dueTimeInput.value.trim().length > 0;
      const hasCustomPriority = priorityInput && priorityInput.value !== "medium";

      if (!hasText && !hasTags && !hasTime && !hasCustomPriority) {
        collapseComposer();
      }
    }
  });
}

// ==========================================================================
// 14. TASK DETAILS DRAWER & DEBOUNCED AUTOSAVE
// ==========================================================================
let autosaveTimer = null;

function scheduleDrawerAutosave() {
  if (!state.activeDrawerTodoId) return;

  if (drawerSaveStatus) {
    drawerSaveStatus.textContent = "Saving…";
    drawerSaveStatus.classList.add("saving");
  }

  if (autosaveTimer) clearTimeout(autosaveTimer);

  autosaveTimer = setTimeout(() => {
    flushDrawerAutosave();
  }, 300);
}

function flushDrawerAutosave() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  const todoId = state.activeDrawerTodoId;
  if (!todoId) return;

  const todo = state.todos.find((t) => t.id === todoId);
  if (!todo) return;

  const title = drawerTitleInput.value.trim() || todo.title;
  const description = drawerDescInput.value;
  const priority = drawerPriorityInput.value;
  const projectId = drawerProjectInput.value || null;
  const dueDate = drawerDueDateInput.value;
  const dueTime = drawerDueTimeInput.value;
  const recurrence = drawerRecurrenceInput.value;
  const reminder = drawerReminderInput.value || null;
  const notes = drawerNotesInput.value;

  const hasChanged =
    todo.title !== title ||
    todo.description !== description ||
    todo.priority !== priority ||
    todo.projectId !== projectId ||
    todo.dueDate !== dueDate ||
    todo.dueTime !== dueTime ||
    todo.recurrence !== recurrence ||
    todo.reminder !== reminder ||
    todo.notes !== notes;

  if (hasChanged) {
    state.todos = state.todos.map((t) => {
      if (t.id === todoId) {
        return {
          ...t,
          title,
          description,
          priority,
          projectId,
          dueDate,
          dueTime,
          recurrence,
          reminder,
          notes
        };
      }
      return t;
    });

    DataStore.saveTodos(state.todos);
    render();
  }

  if (drawerSaveStatus) {
    drawerSaveStatus.textContent = "Saved ✓";
    drawerSaveStatus.classList.remove("saving");
  }
}

function openTaskDetails(todoId) {
  flushDrawerAutosave();

  const todo = state.todos.find((t) => t.id === todoId);
  if (!todo) return;

  state.lastFocusedElement = document.activeElement;
  state.activeDrawerTodoId = todoId;

  drawerTitleInput.value = todo.title;
  drawerDescInput.value = todo.description || "";
  drawerPriorityInput.value = todo.priority || "medium";
  drawerDueDateInput.value = todo.dueDate || "";
  drawerDueTimeInput.value = todo.dueTime || "";
  drawerRecurrenceInput.value = todo.recurrence || "none";
  drawerReminderInput.value = todo.reminder || "";
  drawerNotesInput.value = todo.notes || "";

  drawerProjectInput.innerHTML = '<option value="">Inbox</option>';
  state.projects.forEach((proj) => {
    const opt = document.createElement("option");
    opt.value = proj.id;
    opt.textContent = proj.name;
    if (todo.projectId === proj.id) opt.selected = true;
    drawerProjectInput.appendChild(opt);
  });

  updateDrawerStatusButton(todo);
  renderDrawerTags(todo);
  renderDrawerSubtasks(todo);

  drawerCreatedAtLabel.textContent = `Created: ${formatTimestamp(todo.createdAt)}`;
  drawerCompletedAtLabel.textContent = todo.completedAt ? `Completed: ${formatTimestamp(todo.completedAt)}` : "";

  drawerSaveStatus.textContent = "Saved ✓";
  drawerSaveStatus.classList.remove("saving");

  taskDetailsDrawer.classList.add("open");
  taskDetailsDrawer.setAttribute("aria-hidden", "false");
  drawerOverlay.classList.add("active");
  drawerOverlay.setAttribute("aria-hidden", "false");
}

function closeTaskDetails() {
  flushDrawerAutosave();

  state.activeDrawerTodoId = null;
  taskDetailsDrawer.classList.remove("open");
  taskDetailsDrawer.setAttribute("aria-hidden", "true");
  drawerOverlay.classList.remove("active");
  drawerOverlay.setAttribute("aria-hidden", "true");

  if (state.lastFocusedElement && typeof state.lastFocusedElement.focus === "function") {
    state.lastFocusedElement.focus();
  }
}

function updateDrawerStatusButton(todo) {
  if (!drawerToggleStatusBtn) return;
  drawerToggleStatusBtn.classList.toggle("is-completed", todo.completed);
  drawerStatusText.textContent = todo.completed ? "Completed" : "Incomplete";
}

function renderDrawerTags(todo) {
  drawerTagsList.innerHTML = "";
  (todo.tags || []).forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "drawer-tag-chip";
    chip.innerHTML = `
      <span>#${tag}</span>
      <button type="button" class="drawer-tag-remove" aria-label="Remove tag #${tag}">&times;</button>
    `;
    chip.querySelector(".drawer-tag-remove").addEventListener("click", () => {
      todo.tags = todo.tags.filter((t) => t !== tag);
      DataStore.saveTodos(state.todos);
      renderDrawerTags(todo);
      render();
    });
    drawerTagsList.appendChild(chip);
  });
}

function renderDrawerSubtasks(todo) {
  const subtasks = todo.subtasks || [];
  const completedCount = subtasks.filter((s) => s.completed).length;
  const totalCount = subtasks.length;
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  drawerSubtasksProgressText.textContent = `${completedCount} / ${totalCount}`;
  drawerSubtaskProgressBar.style.width = `${pct}%`;

  drawerSubtaskList.innerHTML = "";

  subtasks.forEach((st) => {
    const li = document.createElement("li");
    li.className = `drawer-subtask-item${st.completed ? " done" : ""}`;
    li.dataset.id = st.id;

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.className = "subtask-checkbox";
    chk.checked = st.completed;
    chk.setAttribute("aria-label", `Mark subtask "${st.title}" as ${st.completed ? "incomplete" : "complete"}`);
    chk.addEventListener("change", () => {
      st.completed = chk.checked;
      DataStore.saveTodos(state.todos);
      renderDrawerSubtasks(todo);
      render();
    });

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "subtask-title-input";
    titleInput.value = st.title;
    titleInput.addEventListener("input", () => {
      st.title = titleInput.value.trim();
      scheduleDrawerAutosave();
    });
    titleInput.addEventListener("blur", () => {
      flushDrawerAutosave();
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn icon-btn-tiny subtask-delete-btn";
    delBtn.setAttribute("aria-label", `Delete subtask "${st.title}"`);
    delBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    `;
    delBtn.addEventListener("click", () => {
      todo.subtasks = todo.subtasks.filter((s) => s.id !== st.id);
      DataStore.saveTodos(state.todos);
      renderDrawerSubtasks(todo);
      render();
    });

    li.append(chk, titleInput, delBtn);
    drawerSubtaskList.appendChild(li);
  });
}

function setupDrawerListeners() {
  if (!taskDetailsDrawer) return;

  drawerCloseBtn.addEventListener("click", closeTaskDetails);
  drawerOverlay.addEventListener("click", closeTaskDetails);

  drawerToggleStatusBtn.addEventListener("click", () => {
    if (!state.activeDrawerTodoId) return;
    toggleTodo(state.activeDrawerTodoId);
    const todo = state.todos.find((t) => t.id === state.activeDrawerTodoId);
    if (todo) {
      updateDrawerStatusButton(todo);
    }
  });

  drawerDuplicateBtn.addEventListener("click", () => {
    if (!state.activeDrawerTodoId) return;
    const currentId = state.activeDrawerTodoId;
    closeTaskDetails();
    handleDuplicateTodo(currentId);
  });

  drawerDeleteBtn.addEventListener("click", () => {
    if (!state.activeDrawerTodoId) return;
    const currentId = state.activeDrawerTodoId;
    closeTaskDetails();
    deleteTodo(currentId);
  });

  [
    drawerTitleInput,
    drawerDescInput,
    drawerPriorityInput,
    drawerProjectInput,
    drawerDueDateInput,
    drawerDueTimeInput,
    drawerRecurrenceInput,
    drawerReminderInput,
    drawerNotesInput
  ].forEach((inputEl) => {
    if (inputEl) {
      inputEl.addEventListener("input", scheduleDrawerAutosave);
      inputEl.addEventListener("change", scheduleDrawerAutosave);
    }
  });

  drawerTagsInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const raw = drawerTagsInput.value.trim();
      if (!raw || !state.activeDrawerTodoId) return;

      const todo = state.todos.find((t) => t.id === state.activeDrawerTodoId);
      if (!todo) return;

      const norm = normalizeTag(raw);
      if (norm && !todo.tags.includes(norm)) {
        todo.tags.push(norm);
        DataStore.saveTodos(state.todos);
        renderDrawerTags(todo);
        render();
      }
      drawerTagsInput.value = "";
    }
  });

  drawerAddSubtaskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = newSubtaskInput.value.trim();
    if (!title || !state.activeDrawerTodoId) return;

    const todo = state.todos.find((t) => t.id === state.activeDrawerTodoId);
    if (!todo) return;

    todo.subtasks.push({
      id: crypto.randomUUID(),
      title,
      completed: false,
      createdAt: new Date().toISOString()
    });

    DataStore.saveTodos(state.todos);
    newSubtaskInput.value = "";
    renderDrawerSubtasks(todo);
    render();
  });
}

// ==========================================================================
// 15. PROJECT MANAGEMENT MODAL (Create, Rename, Color, Safe Delete)
// ==========================================================================
function openProjectModal(editProjectId = null) {
  state.lastFocusedElement = document.activeElement;
  projectModalEditId.value = editProjectId || "";

  projectColorPalette.innerHTML = "";
  const initialColor = editProjectId
    ? (state.projects.find((p) => p.id === editProjectId) || {}).color || PROJECT_COLORS[0]
    : PROJECT_COLORS[0];

  PROJECT_COLORS.forEach((hex) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `color-swatch-btn${hex === initialColor ? " selected" : ""}`;
    btn.style.backgroundColor = hex;
    btn.style.color = hex;
    btn.dataset.color = hex;
    btn.setAttribute("aria-label", `Color ${hex}`);
    btn.addEventListener("click", () => {
      document.querySelectorAll(".color-swatch-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
    projectColorPalette.appendChild(btn);
  });

  if (editProjectId) {
    const proj = state.projects.find((p) => p.id === editProjectId);
    if (!proj) return;
    projectModalTitle.textContent = `Edit Project: ${proj.name}`;
    projectNameInput.value = proj.name;
    deleteProjectBtn.style.display = "block";
  } else {
    projectModalTitle.textContent = "New Project";
    projectNameInput.value = "";
    deleteProjectBtn.style.display = "none";
  }

  projectModalOverlay.classList.add("active");
  projectModalOverlay.setAttribute("aria-hidden", "false");
  projectNameInput.focus();
}

function closeProjectModal() {
  projectModalOverlay.classList.remove("active");
  projectModalOverlay.setAttribute("aria-hidden", "true");
  projectModalForm.reset();

  if (state.lastFocusedElement && typeof state.lastFocusedElement.focus === "function") {
    state.lastFocusedElement.focus();
  }
}

function setupProjectModalListeners() {
  if (!projectModal) return;

  if (addProjectBtn) {
    addProjectBtn.addEventListener("click", () => openProjectModal(null));
  }

  closeProjectModalBtn.addEventListener("click", closeProjectModal);
  cancelProjectModalBtn.addEventListener("click", closeProjectModal);
  projectModalOverlay.addEventListener("click", (e) => {
    if (e.target === projectModalOverlay) closeProjectModal();
  });

  projectModalForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = projectNameInput.value.trim();
    if (!name) return;

    const selectedSwatch = projectColorPalette.querySelector(".color-swatch-btn.selected");
    const color = selectedSwatch ? selectedSwatch.dataset.color : PROJECT_COLORS[0];
    const editId = projectModalEditId.value;

    if (editId) {
      state.projects = state.projects.map((p) =>
        p.id === editId ? { ...p, name, color } : p
      );
      DataStore.saveProjects(state.projects);
      showToast(`Project "${name}" updated`, 2200);
    } else {
      const newProj = {
        id: crypto.randomUUID(),
        name,
        color,
        createdAt: new Date().toISOString()
      };
      state.projects.push(newProj);
      DataStore.saveProjects(state.projects);
      showToast(`Project "${name}" created`, 2200);
    }

    closeProjectModal();
    render();
  });

  deleteProjectBtn.addEventListener("click", () => {
    const editId = projectModalEditId.value;
    if (!editId) return;

    const proj = state.projects.find((p) => p.id === editId);
    if (!proj) return;

    const assignedCount = state.todos.filter((t) => t.projectId === editId).length;
    const confirmMsg = assignedCount > 0
      ? `Delete project "${proj.name}"? Its ${assignedCount} task${assignedCount === 1 ? "" : "s"} will move to Inbox.`
      : `Delete project "${proj.name}"?`;

    if (window.confirm(confirmMsg)) {
      DataStore.deleteProject(editId);
      closeProjectModal();
      if (state.currentView === `project:${editId}`) {
        setView("inbox");
      } else {
        render();
      }
      showToast(`Project "${proj.name}" deleted. Tasks moved to Inbox.`, 2800, () => {
        state.undoManager.undo();
      });
    }
  });
}

// ==========================================================================
// 16. TASK CONTEXT MENU (••• Action Popover)
// ==========================================================================
function openContextMenu(e, todoId) {
  e.preventDefault();
  e.stopPropagation();

  state.activeContextMenuTodoId = todoId;
  const todo = state.todos.find((t) => t.id === todoId);
  if (!todo) return;

  ctxProjectSubmenu.innerHTML = "";

  const inboxBtn = document.createElement("button");
  inboxBtn.className = "context-menu-item";
  inboxBtn.innerHTML = `<span>Inbox (Unassigned)</span>`;
  inboxBtn.addEventListener("click", () => {
    moveTodoToProject(todoId, null);
    closeContextMenu();
  });
  ctxProjectSubmenu.appendChild(inboxBtn);

  state.projects.forEach((proj) => {
    const projBtn = document.createElement("button");
    projBtn.className = `context-menu-item${todo.projectId === proj.id ? " active" : ""}`;
    projBtn.innerHTML = `
      <span class="project-dot" style="background:${proj.color}"></span>
      <span>${proj.name}</span>
    `;
    projBtn.addEventListener("click", () => {
      moveTodoToProject(todoId, proj.id);
      closeContextMenu();
    });
    ctxProjectSubmenu.appendChild(projBtn);
  });

  const triggerRect = e.currentTarget.getBoundingClientRect();
  const menuWidth = 190;
  const menuHeight = 220;

  let left = triggerRect.right - menuWidth;
  if (left < 10) left = 10;
  if (left + menuWidth > window.innerWidth - 10) left = window.innerWidth - menuWidth - 10;

  let top = triggerRect.bottom + 6;
  if (top + menuHeight > window.innerHeight - 10) {
    top = triggerRect.top - menuHeight - 6;
  }

  taskContextMenu.style.left = `${left}px`;
  taskContextMenu.style.top = `${top}px`;
  taskContextMenu.classList.add("open");
  taskContextMenu.setAttribute("aria-hidden", "false");
}

function closeContextMenu() {
  state.activeContextMenuTodoId = null;
  taskContextMenu.classList.remove("open");
  taskContextMenu.setAttribute("aria-hidden", "true");
}

function moveTodoToProject(todoId, nextProjectId) {
  state.todos = state.todos.map((t) =>
    t.id === todoId ? { ...t, projectId: nextProjectId } : t
  );
  DataStore.saveTodos(state.todos);
  render();
  const proj = state.projects.find((p) => p.id === nextProjectId);
  showToast(proj ? `Moved to ${proj.name}` : "Moved to Inbox", 2000);
}

function handleDuplicateTodo(todoId) {
  const original = state.todos.find((t) => t.id === todoId);
  if (!original) return;

  const clone = duplicateTodo(original);
  state.todos = [clone, ...state.todos];
  DataStore.saveTodos(state.todos);
  render();
  showToast(`Duplicated "${clone.title}"`, 2200);
}

function setupContextMenuListeners() {
  if (!taskContextMenu) return;

  ctxOpenDetails.addEventListener("click", () => {
    const id = state.activeContextMenuTodoId;
    closeContextMenu();
    if (id) openTaskDetails(id);
  });

  ctxDuplicate.addEventListener("click", () => {
    const id = state.activeContextMenuTodoId;
    closeContextMenu();
    if (id) handleDuplicateTodo(id);
  });

  ctxDelete.addEventListener("click", () => {
    const id = state.activeContextMenuTodoId;
    closeContextMenu();
    if (id) deleteTodo(id);
  });

  document.addEventListener("click", (e) => {
    if (!taskContextMenu.contains(e.target)) {
      closeContextMenu();
    }
  });
}

// ==========================================================================
// 17. CLICKABLE STAT CARDS & USER PROFILE MENU
// ==========================================================================
function setupStatCards() {
  if (cardToday) {
    cardToday.addEventListener("click", () => setView("today"));
    cardToday.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setView("today");
      }
    });
  }

  if (cardOverdue) {
    cardOverdue.addEventListener("click", () => setView("overdue"));
    cardOverdue.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setView("overdue");
      }
    });
  }

  if (cardCompleted) {
    cardCompleted.addEventListener("click", () => setView("completed"));
    cardCompleted.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setView("completed");
      }
    });
  }

  if (cardStreak) {
    const handleStreak = () => {
      const completedTodos = state.todos.filter((t) => t.completed);
      const streak = calculateStreak(completedTodos);
      showToast(`🔥 ${streak}-day completion streak! Keep up the momentum.`, 3500);
    };
    cardStreak.addEventListener("click", handleStreak);
    cardStreak.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleStreak();
      }
    });
  }
}

function setupUserProfileMenu() {
  if (!userProfileBtn || !userProfileWrap) return;

  userProfileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = userProfileWrap.classList.toggle("open");
    userProfileBtn.setAttribute("aria-expanded", String(isOpen));
  });

  document.addEventListener("click", (e) => {
    if (!userProfileWrap.contains(e.target)) {
      userProfileWrap.classList.remove("open");
      userProfileBtn.setAttribute("aria-expanded", "false");
    }
  });

  if (menuSignInBtn) {
    menuSignInBtn.addEventListener("click", () => {
      userProfileWrap.classList.remove("open");
      userProfileBtn.setAttribute("aria-expanded", "false");
      AuthManager.openSignIn();
    });
  }

  if (menuManageAccountBtn) {
    menuManageAccountBtn.addEventListener("click", () => {
      userProfileWrap.classList.remove("open");
      userProfileBtn.setAttribute("aria-expanded", "false");
      AuthManager.openAccountManagement();
    });
  }

  if (menuSignOutBtn) {
    menuSignOutBtn.addEventListener("click", () => {
      userProfileWrap.classList.remove("open");
      userProfileBtn.setAttribute("aria-expanded", "false");
      AuthManager.signOut();
    });
  }

  if (menuToggleThemeBtn) {
    menuToggleThemeBtn.addEventListener("click", () => {
      toggleTheme();
      userProfileWrap.classList.remove("open");
    });
  }

  if (menuExportDataBtn) {
    menuExportDataBtn.addEventListener("click", () => {
      DataStore.exportData();
      userProfileWrap.classList.remove("open");
      showToast("Workspace backup exported (JSON)", 2500);
    });
  }

  if (menuClearCompletedBtn) {
    menuClearCompletedBtn.addEventListener("click", () => {
      userProfileWrap.classList.remove("open");
      clearCompleted();
    });
  }
}

// ==========================================================================
// 17B. AUTHENTICATION & CLERK IDENTITY MANAGER (STAGE 4B)
// ==========================================================================
const AuthManager = {
  status: "loading", // "loading" | "signed_out" | "signed_in"
  currentUser: null,  // { id, authProviderId, email, displayName, avatarUrl, createdAt }
  clerk: null,
  publishableKey: null,
  isInitialized: false,

  // Multi-step Email Code flow state
  flowState: {
    step: 1,           // 1 = Email entry, 2 = Verification code
    mode: null,        // "sign_in" | "sign_up"
    email: "",
    emailAddressId: null
  },

  isAuthenticated() {
    return this.status === "signed_in" && Boolean(this.currentUser);
  },

  async init() {
    this.setupListeners();

    try {
      // 1. Fetch Clerk Publishable Key safely from backend config endpoint
      const configRes = await fetch("/api/auth/config");
      if (!configRes.ok) {
        throw new Error(`Failed to load auth config: ${configRes.status}`);
      }
      const config = await configRes.json();
      this.publishableKey = config.publishableKey;

      if (!this.publishableKey) {
        console.warn("Clerk publishable key not configured; running in Local Mode.");
        this.setSignedOutState();
        return;
      }

      // 2. Load ClerkJS dynamic browser bundle into DOM
      await this.loadClerkScript();

      if (!window.Clerk) {
        throw new Error("Clerk SDK failed to initialize.");
      }

      // 3. Initialize Clerk instance
      this.clerk = window.Clerk;
      await this.clerk.load();

      this.isInitialized = true;

      // 4. Listen to auth state transitions
      this.clerk.addListener(async (emission) => {
        const { user, session } = emission || {};
        if (user && session) {
          await this.syncUserWithBackend(session);
        } else {
          this.setSignedOutState();
        }
      });

      // 5. Initial auth evaluation
      if (this.clerk.user && this.clerk.session) {
        await this.syncUserWithBackend(this.clerk.session);
      } else {
        this.setSignedOutState();
      }
    } catch (err) {
      console.warn("Auth initialization fallback to Local Mode:", err);
      this.status = "signed_out";
      this.setSignedOutState();
    }
  },

  loadClerkScript() {
    return new Promise((resolve, reject) => {
      if (window.Clerk) return resolve();

      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js";
      script.async = true;
      script.crossOrigin = "anonymous";
      script.setAttribute("data-clerk-publishable-key", this.publishableKey);

      script.onload = () => resolve();
      script.onerror = (e) => reject(new Error("Failed to load ClerkJS script from CDN"));
      document.head.appendChild(script);
    });
  },

  showError(message) {
    const errorAlert = document.getElementById("authErrorAlert");
    const errorMessage = document.getElementById("authErrorMessage");
    if (errorAlert && errorMessage) {
      errorMessage.textContent = message || "An unexpected error occurred. Please try again.";
      errorAlert.style.display = "flex";
    }
  },

  clearError() {
    const errorAlert = document.getElementById("authErrorAlert");
    if (errorAlert) {
      errorAlert.style.display = "none";
    }
  },

  setLoading(btnId, isLoading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = isLoading;
    const btnText = btn.querySelector(".btn-text");
    const spinner = btn.querySelector(".auth-btn-spinner");
    if (btnText) btnText.style.display = isLoading ? "none" : "inline";
    if (spinner) spinner.style.display = isLoading ? "inline-block" : "none";
  },

  setStep(step) {
    this.flowState.step = step;
    this.clearError();

    const step1 = document.getElementById("authStep1");
    const step2 = document.getElementById("authStep2");
    const targetEmailLabel = document.getElementById("authTargetEmailLabel");
    const codeInput = document.getElementById("authCodeInput");
    const emailInput = document.getElementById("authEmailInput");

    if (step === 1) {
      if (step1) step1.style.display = "block";
      if (step2) step2.style.display = "none";
      if (emailInput) {
        setTimeout(() => emailInput.focus(), 50);
      }
    } else if (step === 2) {
      if (step1) step1.style.display = "none";
      if (step2) step2.style.display = "block";
      if (targetEmailLabel) targetEmailLabel.textContent = this.flowState.email;
      if (codeInput) {
        codeInput.value = "";
        setTimeout(() => codeInput.focus(), 50);
      }
    }
  },

  openSignIn() {
    this.setStep(1);
    this.clearError();

    if (userProfileWrap) userProfileWrap.classList.remove("open");
    if (userProfileBtn) userProfileBtn.setAttribute("aria-expanded", "false");

    const authModalOverlay = document.getElementById("authModalOverlay");
    if (authModalOverlay) {
      authModalOverlay.classList.add("active");
      authModalOverlay.setAttribute("aria-hidden", "false");
    }

    const emailInput = document.getElementById("authEmailInput");
    if (emailInput) {
      setTimeout(() => emailInput.focus(), 50);
    }
  },

  closeSignInModal() {
    const authModalOverlay = document.getElementById("authModalOverlay");
    if (authModalOverlay) {
      authModalOverlay.classList.remove("active");
      authModalOverlay.setAttribute("aria-hidden", "true");
    }
    this.clearError();
  },

  async handleEmailSubmit(e) {
    if (e) e.preventDefault();
    this.clearError();

    const emailInput = document.getElementById("authEmailInput");
    const email = (emailInput?.value || "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      this.showError("Please enter a valid email address.");
      return;
    }

    if (!this.clerk) {
      this.showError("Authentication service is initializing. Please try in a moment.");
      return;
    }

    this.setLoading("authContinueEmailBtn", true);

    try {
      this.flowState.email = email;
      const tempSecret = `M0m!_${crypto.randomUUID()}#9Z`;
      this.flowState.tempSecret = tempSecret;

      console.log("[Momentum Auth] Starting email flow for:", email);

      // 1. Try initiating Sign-In with email code
      let signInSuccess = false;
      try {
        const signIn = await this.clerk.client.signIn.create({
          identifier: email
        });
        console.log("[Momentum Auth] SignIn attempt created:", signIn);

        // Check for direct email_code factor in supportedFirstFactors
        const emailCodeFactor = signIn.supportedFirstFactors?.find(
          (f) => f.strategy === "email_code"
        );

        if (emailCodeFactor && emailCodeFactor.emailAddressId) {
          console.log("[Momentum Auth] Preparing direct email_code factor");
          await signIn.prepareFirstFactor({
            strategy: "email_code",
            emailAddressId: emailCodeFactor.emailAddressId
          });

          this.flowState.mode = "sign_in_email_code";
          this.flowState.emailAddressId = emailCodeFactor.emailAddressId;
          this.setStep(2);
          signInSuccess = true;
          return;
        }

        // Check for reset_password_email_code factor (for existing accounts with password)
        const resetCodeFactor = signIn.supportedFirstFactors?.find(
          (f) => f.strategy === "reset_password_email_code"
        );

        if (resetCodeFactor && resetCodeFactor.emailAddressId) {
          console.log("[Momentum Auth] Preparing reset_password_email_code factor");
          await signIn.prepareFirstFactor({
            strategy: "reset_password_email_code",
            emailAddressId: resetCodeFactor.emailAddressId
          });

          this.flowState.mode = "sign_in_reset_code";
          this.flowState.emailAddressId = resetCodeFactor.emailAddressId;
          this.setStep(2);
          signInSuccess = true;
          return;
        }
      } catch (signInErr) {
        console.log("[Momentum Auth] SignIn create error (user likely new):", signInErr);
      }

      if (signInSuccess) return;

      // 2. User is new or needs Sign-Up -> Initiate Sign-Up
      console.log("[Momentum Auth] Initiating SignUp for:", email);
      let signUp = null;
      try {
        // Attempt with temp secret to satisfy any instance password requirements seamlessly
        signUp = await this.clerk.client.signUp.create({
          emailAddress: email,
          password: tempSecret
        });
      } catch (signUpWithPwErr) {
        console.log("[Momentum Auth] SignUp with password failed; trying email-only create:", signUpWithPwErr);
        signUp = await this.clerk.client.signUp.create({
          emailAddress: email
        });
      }

      console.log("[Momentum Auth] SignUp created:", signUp);

      await signUp.prepareEmailAddressVerification({
        strategy: "email_code"
      });

      console.log("[Momentum Auth] Prepared SignUp email verification");
      this.flowState.mode = "sign_up";
      this.flowState.emailAddressId = null;
      this.setStep(2);
    } catch (err) {
      console.error("[Momentum Auth] Email authentication error:", err);
      const msg = err.errors?.[0]?.longMessage || err.errors?.[0]?.message || err.message || "Failed to send verification code.";
      this.showError(msg);
    } finally {
      this.setLoading("authContinueEmailBtn", false);
    }
  },

  async handleCodeSubmit(e) {
    if (e) e.preventDefault();
    this.clearError();

    const codeInput = document.getElementById("authCodeInput");
    const code = (codeInput?.value || "").trim().replace(/\s+/g, "");

    if (!code || code.length < 6) {
      this.showError("Please enter the complete 6-digit verification code.");
      return;
    }

    if (!this.clerk) {
      this.showError("Authentication service is offline.");
      return;
    }

    this.setLoading("authVerifyCodeBtn", true);

    try {
      let createdSessionId = null;
      console.log(`[Momentum Auth] Submitting code for mode: ${this.flowState.mode}`);

      if (this.flowState.mode === "sign_in_email_code") {
        const result = await this.clerk.client.signIn.attemptFirstFactor({
          strategy: "email_code",
          code: code
        });
        console.log("[Momentum Auth] SignIn attemptFirstFactor result:", result);

        if (result.status === "complete") {
          createdSessionId = result.createdSessionId;
        } else {
          throw new Error(`Sign in status: ${result.status}`);
        }
      } else if (this.flowState.mode === "sign_in_reset_code") {
        const result = await this.clerk.client.signIn.attemptFirstFactor({
          strategy: "reset_password_email_code",
          code: code,
          password: this.flowState.tempSecret
        });
        console.log("[Momentum Auth] SignIn reset_password attemptFirstFactor result:", result);

        if (result.status === "complete") {
          createdSessionId = result.createdSessionId;
        } else {
          throw new Error(`Sign in status: ${result.status}`);
        }
      } else if (this.flowState.mode === "sign_up") {
        let result = await this.clerk.client.signUp.attemptEmailAddressVerification({
          code: code
        });
        console.log("[Momentum Auth] SignUp attemptEmailAddressVerification result:", result);

        if (result.status === "complete") {
          createdSessionId = result.createdSessionId;
        } else if (result.status === "missing_requirements") {
          const missing = result.missingFields || [];
          const unverified = result.unverifiedFields || [];
          const allMissing = Array.from(new Set([...missing, ...unverified]));
          console.warn("[Momentum Auth] SignUp missing requirements:", allMissing);

          if (allMissing.includes("password")) {
            // Fulfill password requirement automatically so user is never blocked
            const updated = await this.clerk.client.signUp.update({
              password: this.flowState.tempSecret || `M0m!_${crypto.randomUUID()}#9Z`
            });
            console.log("[Momentum Auth] Updated SignUp after fulfilling password:", updated);
            if (updated.status === "complete") {
              createdSessionId = updated.createdSessionId;
            } else {
              throw new Error(`Sign up requirements remaining: ${updated.missingFields?.join(", ")}`);
            }
          } else {
            throw new Error(`Sign up requirements: ${allMissing.join(", ")}`);
          }
        } else {
          throw new Error(`Sign up status: ${result.status}`);
        }
      }

      if (createdSessionId) {
        console.log("[Momentum Auth] Verification successful. Setting active session:", createdSessionId);
        await this.clerk.setActive({ session: createdSessionId });
        if (this.clerk.session) {
          await this.syncUserWithBackend(this.clerk.session);
        }
      } else {
        throw new Error("Verification could not complete session creation.");
      }
    } catch (err) {
      console.error("[Momentum Auth] Code verification error:", err);
      const msg = err.errors?.[0]?.longMessage || err.errors?.[0]?.message || err.message || "Incorrect verification code. Please check your email.";
      this.showError(msg);
    } finally {
      this.setLoading("authVerifyCodeBtn", false);
    }
  },

  async handleResendCode() {
    this.clearError();
    if (!this.clerk || !this.flowState.email) return;

    try {
      if (this.flowState.mode === "sign_in_email_code" || this.flowState.mode === "sign_in_reset_code") {
        if (this.flowState.emailAddressId) {
          const strategy = this.flowState.mode === "sign_in_reset_code" ? "reset_password_email_code" : "email_code";
          await this.clerk.client.signIn.prepareFirstFactor({
            strategy: strategy,
            emailAddressId: this.flowState.emailAddressId
          });
        }
      } else if (this.flowState.mode === "sign_up") {
        await this.clerk.client.signUp.prepareEmailAddressVerification({
          strategy: "email_code"
        });
      }
      showToast("Verification code resent! Check your inbox.", 3000);
    } catch (err) {
      console.warn("Resend code error:", err);
      const msg = err.errors?.[0]?.longMessage || err.errors?.[0]?.message || "Could not resend code. Please try again shortly.";
      this.showError(msg);
    }
  },

  async handleGoogleAuth() {
    this.clearError();
    if (!this.clerk) {
      this.showError("Authentication service is connecting…");
      return;
    }

    try {
      const redirectUrl = window.location.origin + window.location.pathname;
      await this.clerk.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: redirectUrl,
        redirectUrlComplete: redirectUrl
      });
    } catch (err) {
      console.warn("Google OAuth error:", err);
      const msg = err.errors?.[0]?.longMessage || err.errors?.[0]?.message || "Google sign-in could not be initiated.";
      this.showError(msg);
    }
  },

  async syncUserWithBackend(session) {
    try {
      this.status = "loading";
      const token = await session.getToken();
      if (!token) {
        throw new Error("Could not retrieve session token");
      }

      const res = await fetch("/api/auth/me", {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Server auth error: ${res.status}`);
      }

      const { user } = await res.json();
      this.currentUser = user;
      this.status = "signed_in";
      this.setSignedInState(user);
      this.closeSignInModal();
      showToast(`Welcome back, ${user.displayName || user.email || "Explorer"}!`, 3000);
    } catch (err) {
      console.error("Backend identity verification failed:", err);
      this.status = "signed_out";
      this.setSignedOutState();
      showToast("Authentication sync failed. Running in Local Mode.", 3500);
    }
  },

  openAccountManagement() {
    if (!this.clerk || !this.currentUser) return;

    if (userProfileWrap) userProfileWrap.classList.remove("open");
    if (userProfileBtn) userProfileBtn.setAttribute("aria-expanded", "false");

    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    this.clerk.openUserProfile({
      appearance: {
        variables: {
          colorPrimary: isDark ? "#f08352" : "#e06b3a",
          colorBackground: isDark ? "#1e1c19" : "#ffffff",
          colorText: isDark ? "#f3eee8" : "#1c1917",
          colorInputBackground: isDark ? "#24211e" : "#f8f7f5",
          colorInputText: isDark ? "#f3eee8" : "#1c1917",
          borderRadius: "10px",
          fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif'
        }
      }
    });
  },

  async signOut() {
    if (userProfileWrap) userProfileWrap.classList.remove("open");
    if (userProfileBtn) userProfileBtn.setAttribute("aria-expanded", "false");

    if (this.clerk) {
      try {
        await this.clerk.signOut();
      } catch (err) {
        console.warn("Clerk sign-out error:", err);
      }
    }

    this.currentUser = null;
    this.status = "signed_out";
    this.setSignedOutState();
    showToast("Signed out. Local workspace is active.", 2500);
  },

  setSignedInState(user) {
    const avatarEl = document.querySelector("#userProfileBtn .user-avatar");
    const nameEl = document.querySelector("#userProfileBtn .user-name");
    const statusEl = document.querySelector("#userProfileBtn .user-status");

    const displayName = user.displayName || (user.email ? user.email.split("@")[0] : "Account");

    if (avatarEl) {
      if (user.avatarUrl) {
        avatarEl.innerHTML = `<img src="${user.avatarUrl}" class="user-avatar-img" alt="${displayName}">`;
      } else {
        avatarEl.textContent = (displayName[0] || "U").toUpperCase();
      }
    }

    if (nameEl) {
      nameEl.textContent = displayName;
    }

    if (statusEl) {
      statusEl.className = "user-status cloud-connected";
      statusEl.innerHTML = `<span class="user-status-dot"></span>Cloud Connected`;
    }

    if (accountMenuHeaderTitle) accountMenuHeaderTitle.textContent = displayName;
    if (accountMenuHeaderSub) accountMenuHeaderSub.textContent = user.email || "Verified Account";

    if (menuSignInBtn) menuSignInBtn.style.display = "none";
    if (menuManageAccountBtn) menuManageAccountBtn.style.display = "flex";
    if (menuSignOutBtn) menuSignOutBtn.style.display = "flex";

    if (accountMenuBadge) {
      accountMenuBadge.textContent = "Cloud Account";
      accountMenuBadge.classList.add("cloud-badge");
    }
  },

  setSignedOutState() {
    const avatarEl = document.querySelector("#userProfileBtn .user-avatar");
    const nameEl = document.querySelector("#userProfileBtn .user-name");
    const statusEl = document.querySelector("#userProfileBtn .user-status");

    if (avatarEl) {
      avatarEl.textContent = "R";
    }

    if (nameEl) {
      nameEl.textContent = "Rukshan";
    }

    if (statusEl) {
      statusEl.className = "user-status";
      statusEl.textContent = "Personal Workspace";
    }

    if (accountMenuHeaderTitle) accountMenuHeaderTitle.textContent = "Local Workspace";
    if (accountMenuHeaderSub) accountMenuHeaderSub.textContent = "Offline-Ready";

    if (menuSignInBtn) menuSignInBtn.style.display = "flex";
    if (menuManageAccountBtn) menuManageAccountBtn.style.display = "none";
    if (menuSignOutBtn) menuSignOutBtn.style.display = "none";

    if (accountMenuBadge) {
      accountMenuBadge.textContent = "Local Mode";
      accountMenuBadge.classList.remove("cloud-badge");
    }
  },

  setupListeners() {
    const closeAuthModalBtn = document.getElementById("closeAuthModalBtn");
    const authModalOverlay = document.getElementById("authModalOverlay");
    const emailForm = document.getElementById("authEmailForm");
    const codeForm = document.getElementById("authCodeForm");
    const googleBtn = document.getElementById("authGoogleBtn");
    const continueLocalBtn = document.getElementById("authContinueLocalBtn");
    const resendCodeBtn = document.getElementById("authResendCodeBtn");
    const changeEmailBtn = document.getElementById("authChangeEmailBtn");
    const codeInput = document.getElementById("authCodeInput");

    if (closeAuthModalBtn) {
      closeAuthModalBtn.addEventListener("click", () => this.closeSignInModal());
    }

    if (authModalOverlay) {
      authModalOverlay.addEventListener("click", (e) => {
        if (e.target === authModalOverlay) {
          this.closeSignInModal();
        }
      });
    }

    if (emailForm) {
      emailForm.addEventListener("submit", (e) => this.handleEmailSubmit(e));
    }

    if (codeForm) {
      codeForm.addEventListener("submit", (e) => this.handleCodeSubmit(e));
    }

    if (codeInput) {
      codeInput.addEventListener("input", (e) => {
        const val = e.target.value.replace(/\D/g, "");
        e.target.value = val;
        if (val.length === 6) {
          this.handleCodeSubmit();
        }
      });
    }

    if (googleBtn) {
      googleBtn.addEventListener("click", () => this.handleGoogleAuth());
    }

    if (continueLocalBtn) {
      continueLocalBtn.addEventListener("click", () => this.closeSignInModal());
    }

    if (resendCodeBtn) {
      resendCodeBtn.addEventListener("click", () => this.handleResendCode());
    }

    if (changeEmailBtn) {
      changeEmailBtn.addEventListener("click", () => this.setStep(1));
    }
  }
};

// ==========================================================================
// 18. ADVANCED MULTI-FIELD SEARCH LOGIC
// ==========================================================================
function matchesAdvancedSearch(todo, query) {
  if (!query || !query.trim()) return true;

  const needle = query.trim().toLowerCase();
  const proj = state.projects.find((p) => p.id === todo.projectId);
  const projName = proj ? proj.name.toLowerCase() : "";
  const formattedDate = formatDueDate(todo.dueDate, todo.dueTime).toLowerCase();

  const inTitle = (todo.title || "").toLowerCase().includes(needle);
  const inDesc = (todo.description || "").toLowerCase().includes(needle);
  const inNotes = (todo.notes || "").toLowerCase().includes(needle);
  const inPriority = (todo.priority || "").toLowerCase().includes(needle);
  const inProject = projName.includes(needle);
  const inDate = formattedDate.includes(needle) || (todo.dueDate || "").includes(needle);
  const inTags = (todo.tags || []).some((t) => t.toLowerCase().includes(needle));
  const inSubtasks = (todo.subtasks || []).some((s) => (s.title || "").toLowerCase().includes(needle));

  return inTitle || inDesc || inNotes || inPriority || inProject || inDate || inTags || inSubtasks;
}

function getVisibleTodos() {
  return state.todos.filter((todo) => {
    let matchesView = true;

    if (state.currentView === "today") {
      matchesView = isToday(todo) || (isOverdue(todo) && !todo.completed);
    } else if (state.currentView === "inbox") {
      matchesView = !todo.projectId;
    } else if (state.currentView === "upcoming") {
      matchesView = isUpcoming(todo);
    } else if (state.currentView === "completed") {
      matchesView = todo.completed;
    } else if (state.currentView === "overdue") {
      matchesView = isOverdue(todo) && !todo.completed;
    } else if (state.currentView === "calendar") {
      matchesView = Boolean(todo.dueDate);
    } else if (state.currentView.startsWith("calendar:")) {
      const selectedDate = state.currentView.slice(9);
      matchesView = todo.dueDate === selectedDate;
    } else if (state.currentView.startsWith("project:")) {
      const projectId = state.currentView.slice(8);
      matchesView = todo.projectId === projectId;
    } else if (state.currentView.startsWith("tag:")) {
      const tag = state.currentView.slice(4).toLowerCase();
      matchesView = (todo.tags || []).includes(tag);
    }

    if (!matchesView) return false;

    const matchesFilter =
      state.filter === "all" ||
      (state.filter === "open" && !todo.completed) ||
      (state.filter === "done" && todo.completed);

    if (!matchesFilter) return false;

    return matchesAdvancedSearch(todo, state.search);
  });
}

// ==========================================================================
// 19. FULL CALENDAR ENGINE (Month Grid & Mobile Agenda Strip)
// ==========================================================================
function renderFullCalendar() {
  if (!calendarViewSection || !calendarMonthGrid) return;

  const { year, month } = state.calendarDate;
  const monthDate = new Date(year, month, 1);
  const currentMonthTitle = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(monthDate);
  calCurrentMonthLabel.textContent = currentMonthTitle;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
  const prevMonthDays = new Date(year, month, 0).getDate();

  calendarMonthGrid.innerHTML = "";

  // 1. Leading days from previous month
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const prevDayNum = prevMonthDays - i;
    const cell = document.createElement("div");
    cell.className = "cal-day-cell is-empty";
    cell.innerHTML = `
      <div class="cal-day-cell-header">
        <span class="cal-day-num">${prevDayNum}</span>
      </div>
    `;
    calendarMonthGrid.appendChild(cell);
  }

  // 2. Days of current month
  const todayStr = getLocalDateString();
  const monthStr = String(month + 1).padStart(2, "0");

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${monthStr}-${String(day).padStart(2, "0")}`;
    const isTodayDate = dateStr === todayStr;
    const isSelected = state.selectedCalendarDate === dateStr;

    const dayTasks = state.todos.filter((t) => t.dueDate === dateStr);
    const sortedDayTasks = sortTodos(dayTasks, "smart");

    const cell = document.createElement("div");
    cell.className = `cal-day-cell${isTodayDate ? " is-today" : ""}${isSelected ? " is-selected" : ""}`;
    cell.dataset.date = dateStr;

    const header = document.createElement("div");
    header.className = "cal-day-cell-header";

    const numSpan = document.createElement("span");
    numSpan.className = "cal-day-num";
    numSpan.textContent = String(day);

    header.appendChild(numSpan);

    if (sortedDayTasks.length > 0) {
      const countSpan = document.createElement("span");
      countSpan.className = "cal-day-task-count";
      countSpan.textContent = `${sortedDayTasks.filter((t) => !t.completed).length} open`;
      header.appendChild(countSpan);
    }

    const tasksWrap = document.createElement("div");
    tasksWrap.className = "cal-day-tasks";

    // Show up to 3 task chips
    const visibleChips = sortedDayTasks.slice(0, 3);
    visibleChips.forEach((task) => {
      const proj = state.projects.find((p) => p.id === task.projectId);
      const dotColor = proj ? proj.color : (task.priority === "high" ? "#e74c3c" : "#f08352");

      const chip = document.createElement("div");
      chip.className = `cal-task-chip${task.completed ? " is-done" : ""}`;
      chip.title = task.title;

      let timeText = "";
      if (task.dueTime) {
        const [hh, mm] = task.dueTime.split(":");
        const h = parseInt(hh, 10);
        const ampm = h >= 12 ? "p" : "a";
        timeText = `${h % 12 || 12}:${mm}${ampm}`;
      }

      chip.innerHTML = `
        <span class="cal-task-dot" style="background-color: ${dotColor};"></span>
        ${timeText ? `<span class="cal-task-time">${timeText}</span>` : ""}
        <span class="cal-task-title">${task.title}</span>
      `;

      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        openTaskDetails(task.id);
      });

      tasksWrap.appendChild(chip);
    });

    if (sortedDayTasks.length > 3) {
      const moreChip = document.createElement("div");
      moreChip.className = "cal-task-chip cal-task-more";
      moreChip.textContent = `+${sortedDayTasks.length - 3} more`;
      tasksWrap.appendChild(moreChip);
    }

    cell.append(header, tasksWrap);

    // Clicking day cell selects date and presets composer
    cell.addEventListener("click", () => {
      state.selectedCalendarDate = dateStr;
      renderFullCalendar();
      dueDateInput.value = dateStr;
      mobileDueDateInput.value = dateStr;
      expandComposer();
      todoInput.focus();
    });

    calendarMonthGrid.appendChild(cell);
  }

  // 3. Render Mobile Date Strip & Agenda Experience
  renderMobileCalendarPlanner();
}

function renderMobileCalendarPlanner() {
  if (!mobileCalDateStrip || !mobileAgendaList) return;

  const { year, month } = state.calendarDate;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthStr = String(month + 1).padStart(2, "0");
  const todayStr = getLocalDateString();

  mobileCalDateStrip.innerHTML = "";

  const weekdaysShort = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${monthStr}-${String(day).padStart(2, "0")}`;
    const d = new Date(year, month, day);
    const weekday = weekdaysShort[d.getDay()];
    const isSelected = state.selectedCalendarDate === dateStr;
    const hasTasks = state.todos.some((t) => t.dueDate === dateStr && !t.completed);

    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = `mobile-date-pill${isSelected ? " selected" : ""}${dateStr === todayStr ? " is-today" : ""}`;
    pill.innerHTML = `
      <span class="mobile-date-pill-weekday">${weekday}</span>
      <span class="mobile-date-pill-num">${day}</span>
      ${hasTasks ? '<span class="mobile-date-dot">●</span>' : ""}
    `;

    pill.addEventListener("click", () => {
      state.selectedCalendarDate = dateStr;
      renderFullCalendar();
    });

    mobileCalDateStrip.appendChild(pill);
  }

  // Auto-scroll selected pill into view
  const selectedPill = mobileCalDateStrip.querySelector(".mobile-date-pill.selected");
  if (selectedPill) {
    selectedPill.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  // Render Agenda for selected date
  const selectedDateTasks = sortTodos(
    state.todos.filter((t) => t.dueDate === state.selectedCalendarDate),
    "smart"
  );

  mobileAgendaDateTitle.textContent = formatDueDate(state.selectedCalendarDate) || "Selected Date";
  mobileAgendaList.innerHTML = "";

  if (selectedDateTasks.length === 0) {
    const emptyLi = document.createElement("li");
    emptyLi.className = "mobile-agenda-empty";
    emptyLi.innerHTML = `
      <p>No tasks scheduled for this day.</p>
      <button type="button" class="ghost-btn empty-state-cta" id="mobileCalAddBtn">+ Add task for this day</button>
    `;
    emptyLi.querySelector("#mobileCalAddBtn").addEventListener("click", () => {
      mobileDueDateInput.value = state.selectedCalendarDate;
      openMobileBottomSheet();
    });
    mobileAgendaList.appendChild(emptyLi);
  } else {
    selectedDateTasks.forEach((task) => {
      const proj = state.projects.find((p) => p.id === task.projectId);
      const li = document.createElement("li");
      li.className = `mobile-agenda-item${task.completed ? " done" : ""}`;
      li.innerHTML = `
        <div class="mobile-agenda-item-left">
          <input type="checkbox" class="todo-toggle" ${task.completed ? "checked" : ""} aria-label="Toggle ${task.title}">
          <div>
            <p class="mobile-agenda-task-title">${task.title}</p>
            <div class="mobile-agenda-task-meta">
              ${proj ? `<span class="todo-meta-item">${proj.name}</span> · ` : ""}
              ${task.dueTime ? `<span>${task.dueTime}</span> · ` : ""}
              <span class="badge priority-${task.priority}">${capitalize(task.priority)}</span>
            </div>
          </div>
        </div>
      `;

      li.querySelector(".todo-toggle").addEventListener("click", (e) => e.stopPropagation());
      li.querySelector(".todo-toggle").addEventListener("change", () => toggleTodo(task.id));
      li.addEventListener("click", () => openTaskDetails(task.id));
      mobileAgendaList.appendChild(li);
    });
  }
}

function setupCalendarNavListeners() {
  if (!calPrevMonthBtn || !calNextMonthBtn || !calTodayBtn) return;

  calPrevMonthBtn.addEventListener("click", () => {
    let { year, month } = state.calendarDate;
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
    state.calendarDate = { year, month };
    renderFullCalendar();
  });

  calNextMonthBtn.addEventListener("click", () => {
    let { year, month } = state.calendarDate;
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    state.calendarDate = { year, month };
    renderFullCalendar();
  });

  calTodayBtn.addEventListener("click", () => {
    const now = new Date();
    state.calendarDate = { year: now.getFullYear(), month: now.getMonth() };
    state.selectedCalendarDate = getLocalDateString(now);
    renderFullCalendar();
  });
}

// ==========================================================================
// 20. RENDERING ENGINE
// ==========================================================================
function render() {
  const openTodos = state.todos.filter((t) => !t.completed);
  const completedTodos = state.todos.filter((t) => t.completed);

  const todayTasks = state.todos.filter((t) => isToday(t) && !t.completed);
  const overdueTasks = state.todos.filter((t) => isOverdue(t) && !t.completed);
  const inboxTasks = state.todos.filter((t) => !t.projectId && !t.completed);
  const upcomingTasks = state.todos.filter((t) => isUpcoming(t) && !t.completed);

  // Header Date & Dynamic Greeting
  if (heroDate) {
    heroDate.textContent = getFormattedHeaderDate();
  }

  const greeting = getTimeGreeting();
  if (heroGreetingText) {
    heroGreetingText.textContent = `${greeting},`;
  }

  if (state.currentView === "today") {
    const plannedCount = todayTasks.length + overdueTasks.length;
    heroSubtitle.textContent =
      plannedCount > 0
        ? `You have ${plannedCount} task${plannedCount === 1 ? "" : "s"} planned for today.`
        : "Today is clear. Nothing demanding your attention.";
  } else if (state.currentView === "inbox") {
    heroSubtitle.textContent = "Capture tasks quickly, organize them when you are ready.";
  } else if (state.currentView === "upcoming") {
    heroSubtitle.textContent = "Plan ahead and see what lies on your horizon.";
  } else if (state.currentView === "completed") {
    heroSubtitle.textContent = "A log of everything you’ve achieved.";
  } else if (state.currentView === "overdue") {
    heroSubtitle.textContent =
      overdueTasks.length > 0
        ? `You have ${overdueTasks.length} overdue task${overdueTasks.length === 1 ? "" : "s"} needing attention.`
        : "You are completely up to date. No overdue tasks!";
  } else if (state.currentView.startsWith("project:")) {
    const projectId = state.currentView.slice(8);
    const proj = state.projects.find((p) => p.id === projectId);
    const projOpen = state.todos.filter((t) => t.projectId === projectId && !t.completed).length;
    const projDone = state.todos.filter((t) => t.projectId === projectId && t.completed).length;
    heroSubtitle.textContent = proj
      ? `${projOpen} open · ${projDone} completed in ${proj.name}.`
      : "Project workspace.";
  } else if (state.currentView.startsWith("tag:")) {
    const tagName = state.currentView.slice(4);
    heroSubtitle.textContent = `All tasks tagged with #${tagName}.`;
  } else if (state.currentView.startsWith("calendar:")) {
    const calDate = state.currentView.slice(9);
    heroSubtitle.textContent = `Tasks scheduled for ${formatDueDate(calDate)}.`;
  } else if (state.currentView === "calendar") {
    heroSubtitle.textContent = "A calm overview of your upcoming schedule and deadlines.";
  } else {
    heroSubtitle.textContent = "A calm schedule of your upcoming tasks.";
  }

  // Update Stats Cards
  statTodayCount.textContent = String(todayTasks.length);
  statOverdueCount.textContent = String(overdueTasks.length);
  statCompletedCount.textContent = String(completedTodos.length);
  const streak = calculateStreak(completedTodos);
  statStreakCount.textContent = String(streak);

  // Update Nav Badges
  navCountToday.textContent = String(todayTasks.length + overdueTasks.length);
  navCountInbox.textContent = String(inboxTasks.length);
  navCountUpcoming.textContent = String(upcomingTasks.length);
  navCountCompleted.textContent = String(completedTodos.length);

  // Render Projects Nav & Dropdown
  renderProjectsNav();

  // Render Tags Cloud Nav
  renderTagsNav();

  // Switch between Standard List View and Full Calendar View
  if (state.currentView === "calendar") {
    if (calendarViewSection) calendarViewSection.style.display = "block";
    if (listPanel) listPanel.style.display = "none";
    if (controlsPanel) controlsPanel.style.display = "none";
    renderFullCalendar();
  } else {
    if (calendarViewSection) calendarViewSection.style.display = "none";
    if (listPanel) listPanel.style.display = "block";
    if (controlsPanel) controlsPanel.style.display = "flex";

    updateViewHeaders();

    const visibleTodos = getVisibleTodos();
    const sortedTodos = sortTodos(visibleTodos, state.sort);
    summaryText.textContent = buildSummary(sortedTodos.length, openTodos.length);

    todoList.innerHTML = "";

    if (sortedTodos.length === 0) {
      todoList.append(buildEmptyStateElement());
    } else {
      sortedTodos.forEach((todo) => {
        todoList.append(buildTodoElement(todo));
      });
    }
  }

  // Render Secondary Desktop Rail (Contextual)
  renderSecondaryRail();

  // Update Active Navigation State
  updateNavActiveStates();
}

function updateViewHeaders() {
  if (state.currentView === "today") {
    sectionSubheader.textContent = "Active board";
    sectionHeader.textContent = "Today’s Board";
  } else if (state.currentView === "inbox") {
    sectionSubheader.textContent = "Unassigned";
    sectionHeader.textContent = "Inbox";
  } else if (state.currentView === "upcoming") {
    sectionSubheader.textContent = "Scheduled";
    sectionHeader.textContent = "Upcoming";
  } else if (state.currentView === "completed") {
    sectionSubheader.textContent = "Archive";
    sectionHeader.textContent = "Completed";
  } else if (state.currentView === "overdue") {
    sectionSubheader.textContent = "Attention";
    sectionHeader.textContent = "Overdue Tasks";
  } else if (state.currentView.startsWith("project:")) {
    const projId = state.currentView.slice(8);
    const proj = state.projects.find((p) => p.id === projId);
    sectionSubheader.textContent = "Project Board";
    sectionHeader.textContent = proj ? proj.name : "Project";
  } else if (state.currentView.startsWith("tag:")) {
    const tag = state.currentView.slice(4);
    sectionSubheader.textContent = "Tag Filter";
    sectionHeader.textContent = `#${tag}`;
  } else if (state.currentView.startsWith("calendar:")) {
    const calDate = state.currentView.slice(9);
    sectionSubheader.textContent = "Schedule";
    sectionHeader.textContent = formatDueDate(calDate);
  } else {
    sectionSubheader.textContent = "Calendar";
    sectionHeader.textContent = "Schedule";
  }
}

function updateNavActiveStates() {
  navItems.forEach((item) => {
    const view = item.dataset.view;
    if (view === state.currentView || (view === "today" && state.currentView === "today")) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });
}

function renderProjectsNav() {
  projectsNavList.innerHTML = "";
  projectInput.innerHTML = '<option value="">Inbox</option>';
  mobileProjectInput.innerHTML = '<option value="">Inbox</option>';

  state.projects.forEach((proj) => {
    const openInProject = state.todos.filter(
      (t) => t.projectId === proj.id && !t.completed
    ).length;

    const li = document.createElement("li");
    li.className = "sidebar-project-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = `nav-item${state.currentView === `project:${proj.id}` ? " active" : ""}`;
    button.dataset.view = `project:${proj.id}`;

    const dot = document.createElement("span");
    dot.className = "project-dot";
    dot.style.color = proj.color || "#f08352";
    dot.style.backgroundColor = proj.color || "#f08352";

    const label = document.createElement("span");
    label.className = "nav-label";
    label.textContent = proj.name;

    const count = document.createElement("span");
    count.className = "nav-count";
    count.textContent = String(openInProject);

    button.append(dot, label, count);
    button.addEventListener("click", () => {
      setView(`project:${proj.id}`);
    });

    button.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openProjectModal(proj.id);
    });

    li.append(button);
    projectsNavList.append(li);

    const option = document.createElement("option");
    option.value = proj.id;
    option.textContent = proj.name;
    projectInput.append(option.cloneNode(true));
    mobileProjectInput.append(option);
  });
}

function renderTagsNav() {
  const allTagsMap = new Map();
  state.todos.forEach((todo) => {
    (todo.tags || []).forEach((tag) => {
      allTagsMap.set(tag, (allTagsMap.get(tag) || 0) + 1);
    });
  });

  tagsNavList.innerHTML = "";
  const tagGroup = document.querySelector("#tagsNavGroup");

  if (allTagsMap.size === 0) {
    if (tagGroup) tagGroup.style.display = "none";
    return;
  }

  if (tagGroup) tagGroup.style.display = "block";

  Array.from(allTagsMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([tag, count]) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = `sidebar-tag-pill${state.currentView === `tag:${tag}` ? " active" : ""}`;
      pill.textContent = `#${tag} (${count})`;
      pill.addEventListener("click", () => {
        setView(`tag:${tag}`);
      });
      tagsNavList.append(pill);
    });
}

function buildSummary(visibleCount, openTodos) {
  if (state.todos.length === 0) {
    return "No tasks yet. Add one above to get started.";
  }
  if (visibleCount === 0) {
    return "No tasks match this filter.";
  }
  return `${visibleCount} showing, ${openTodos} active.`;
}

function buildEmptyStateElement() {
  const li = document.createElement("li");
  li.className = "empty-state";

  const dot = document.createElement("div");
  dot.className = "empty-state-dot";
  dot.setAttribute("aria-hidden", "true");

  const title = document.createElement("h3");
  title.className = "empty-state-title";

  const text = document.createElement("p");
  text.className = "empty-state-text";

  const ctaBtn = document.createElement("button");
  ctaBtn.type = "button";
  ctaBtn.className = "ghost-btn empty-state-cta";

  let showCta = true;

  if (state.currentView === "today") {
    title.textContent = "Today is clear.";
    text.textContent = "Nothing demanding your attention right now.";
    ctaBtn.textContent = "+ Create a task";
  } else if (state.currentView === "inbox") {
    title.textContent = "Inbox zero.";
    text.textContent = "Everything has a place. Capture incoming ideas anytime.";
    ctaBtn.textContent = "+ Create a task";
  } else if (state.currentView === "upcoming") {
    title.textContent = "Nothing on the horizon.";
    text.textContent = "Your schedule is clear. Add future deadlines or milestones.";
    ctaBtn.textContent = "+ Schedule a task";
  } else if (state.currentView === "completed") {
    title.textContent = "Nothing completed yet.";
    text.textContent = "Tasks you check off will appear in this archive.";
    showCta = false;
  } else if (state.currentView === "overdue") {
    title.textContent = "No overdue tasks.";
    text.textContent = "You are completely up to date with your deadlines!";
    showCta = false;
  } else if (state.currentView.startsWith("project:")) {
    const projId = state.currentView.slice(8);
    const proj = state.projects.find((p) => p.id === projId);
    title.textContent = "This project is quiet.";
    text.textContent = `Add tasks to organize your ${proj ? proj.name : "project"} workflow.`;
    ctaBtn.textContent = "+ Add project task";
  } else if (state.currentView.startsWith("tag:")) {
    const tag = state.currentView.slice(4);
    title.textContent = `No tasks tagged #${tag}.`;
    text.textContent = "Assign tags to tasks in the composer to organize them here.";
    ctaBtn.textContent = "+ Create tagged task";
  } else if (state.currentView.startsWith("calendar:")) {
    const calDate = state.currentView.slice(9);
    title.textContent = "No tasks scheduled.";
    text.textContent = `Nothing planned for ${formatDueDate(calDate)} yet.`;
    ctaBtn.textContent = `+ Add task for ${formatDueDate(calDate)}`;
  } else {
    title.textContent = "No tasks found.";
    text.textContent = "Try changing your search or filter options.";
    showCta = false;
  }

  ctaBtn.addEventListener("click", () => {
    if (window.innerWidth <= 767) {
      openMobileBottomSheet();
    } else {
      expandComposer();
      todoInput.focus();
    }
  });

  li.append(dot, title, text);
  if (showCta) {
    li.append(ctaBtn);
  }

  return li;
}

function buildTodoElement(todo) {
  const item = document.createElement("li");
  const isCompleting = state.completingTodoIds.has(todo.id);
  item.className = `todo-item${todo.completed ? " done" : ""}${isCompleting ? " completing" : ""}`;
  item.dataset.id = todo.id;

  // 1. Animated Checkbox
  const toggle = document.createElement("input");
  toggle.className = "todo-toggle";
  toggle.type = "checkbox";
  toggle.checked = todo.completed || isCompleting;
  toggle.setAttribute("aria-label", `Mark "${todo.title}" as ${todo.completed ? "incomplete" : "complete"}`);
  toggle.addEventListener("click", (e) => e.stopPropagation());
  toggle.addEventListener("change", () => toggleTodo(todo.id));

  // 2. Content Container
  const content = document.createElement("div");
  content.className = "todo-content";

  const title = document.createElement("p");
  title.className = "todo-title";
  title.textContent = todo.title;
  content.append(title);

  if (todo.description) {
    const desc = document.createElement("p");
    desc.className = "todo-description";
    desc.textContent = todo.description;
    content.append(desc);
  }

  // Metadata Row
  const meta = document.createElement("div");
  meta.className = "todo-meta";
  const metaSegments = [];

  // Project segment
  if (todo.projectId) {
    const proj = state.projects.find((p) => p.id === todo.projectId);
    if (proj) {
      const projSpan = document.createElement("span");
      projSpan.className = "todo-meta-item";
      projSpan.textContent = proj.name;
      metaSegments.push(projSpan);
    }
  }

  // Due Date segment
  if (todo.dueDate) {
    const dueFormatted = formatDueDate(todo.dueDate, todo.dueTime);
    const overdue = isOverdue(todo);
    const dateSpan = document.createElement("span");
    dateSpan.className = `todo-meta-item${overdue ? " is-overdue" : ""}`;
    dateSpan.textContent = overdue ? `Overdue · ${dueFormatted}` : dueFormatted;
    metaSegments.push(dateSpan);
  }

  // Recurrence segment
  if (todo.recurrence && todo.recurrence !== "none") {
    const recSpan = document.createElement("span");
    recSpan.className = "todo-meta-item";
    recSpan.textContent = `↻ ${capitalize(todo.recurrence)}`;
    metaSegments.push(recSpan);
  }

  // Subtasks progress segment
  const subtasks = todo.subtasks || [];
  if (subtasks.length > 0) {
    const doneSubtasks = subtasks.filter((s) => s.completed).length;
    const subtaskSpan = document.createElement("span");
    subtaskSpan.className = "todo-meta-item";
    subtaskSpan.textContent = `${doneSubtasks}/${subtasks.length} subtasks`;
    metaSegments.push(subtaskSpan);
  }

  metaSegments.forEach((seg, idx) => {
    meta.append(seg);
    if (idx < metaSegments.length - 1 || (todo.tags && todo.tags.length > 0)) {
      const sep = document.createElement("span");
      sep.className = "todo-meta-sep";
      sep.textContent = "·";
      meta.append(sep);
    }
  });

  // Tags
  if (todo.tags && todo.tags.length > 0) {
    todo.tags.forEach((tag, tIdx) => {
      const tagSpan = document.createElement("span");
      tagSpan.className = "todo-meta-tag";
      tagSpan.textContent = `#${tag}`;
      tagSpan.addEventListener("click", (e) => {
        e.stopPropagation();
        setView(`tag:${tag}`);
      });
      meta.append(tagSpan);

      if (tIdx < todo.tags.length - 1) {
        const sep = document.createElement("span");
        sep.className = "todo-meta-sep";
        sep.textContent = "·";
        meta.append(sep);
      }
    });
  }

  content.append(meta);

  if (subtasks.length > 0) {
    const doneSubtasks = subtasks.filter((s) => s.completed).length;
    const subtaskPct = Math.round((doneSubtasks / subtasks.length) * 100);
    const pWrap = document.createElement("div");
    pWrap.className = "todo-subtask-progress-wrap";
    pWrap.innerHTML = `<div class="todo-subtask-progress-fill" style="width: ${subtaskPct}%;"></div>`;
    content.append(pWrap);
  }

  // 3. Actions & Badges
  const actions = document.createElement("div");
  actions.className = "todo-actions";

  actions.append(buildBadge("priority", capitalize(todo.priority), `priority-${todo.priority}`));

  const contextMenuBtn = document.createElement("button");
  contextMenuBtn.className = "icon-btn";
  contextMenuBtn.type = "button";
  contextMenuBtn.title = "Task actions";
  contextMenuBtn.setAttribute("aria-label", `Actions for "${todo.title}"`);
  contextMenuBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="1"></circle>
      <circle cx="19" cy="12" r="1"></circle>
      <circle cx="5" cy="12" r="1"></circle>
    </svg>
  `;
  contextMenuBtn.addEventListener("click", (e) => openContextMenu(e, todo.id));

  actions.append(contextMenuBtn);

  item.style.cursor = "pointer";
  item.addEventListener("click", (e) => {
    if (e.target.closest(".todo-toggle") || e.target.closest(".todo-actions")) return;
    openTaskDetails(todo.id);
  });

  item.append(toggle, content, actions);
  return item;
}

function buildBadge(kind, text, extraClass = "") {
  const badge = document.createElement("span");
  badge.className = `badge ${extraClass}`.trim();
  badge.dataset.kind = kind;
  badge.textContent = text;
  return badge;
}

// ==========================================================================
// 21. SECONDARY DESKTOP RAIL RENDERER (Contextual & Functional)
// ==========================================================================
function renderSecondaryRail() {
  if (!weeklyPercent || !miniCalendarGrid) return;

  const now = new Date();

  // 1. Weekly Focus Calculation (Monday to Sunday)
  const dayOfWeek = (now.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const mondayStr = getLocalDateString(monday);
  const sundayStr = getLocalDateString(sunday);

  const thisWeekCompleted = state.todos.filter((t) => {
    if (!t.completed) return false;
    const date = (t.completedAt || t.createdAt).slice(0, 10);
    return date >= mondayStr && date <= sundayStr;
  }).length;

  const thisWeekRemaining = state.todos.filter((t) => {
    if (t.completed) return false;
    if (!t.dueDate) return true;
    return t.dueDate <= sundayStr;
  }).length;

  const totalWeekly = thisWeekCompleted + thisWeekRemaining;
  const pct = totalWeekly > 0 ? Math.round((thisWeekCompleted / totalWeekly) * 100) : (thisWeekCompleted > 0 ? 100 : 0);

  weeklyPercent.textContent = `${pct}%`;
  weeklyProgressBar.style.width = `${pct}%`;
  weeklySummary.textContent = `${thisWeekCompleted} completed · ${thisWeekRemaining} remaining`;

  // 2. Mini Calendar (Interactive)
  const currentMonthName = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(now);
  miniCalendarMonth.textContent = currentMonthName;

  if (miniCalendarToday) {
    miniCalendarToday.onclick = () => setView("today");
  }

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const firstDayIndex = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7;

  const datesWithTasks = new Set(
    state.todos.filter((t) => t.dueDate && !t.completed).map((t) => t.dueDate)
  );

  miniCalendarGrid.innerHTML = `
    <div class="mini-cal-day-header">M</div>
    <div class="mini-cal-day-header">T</div>
    <div class="mini-cal-day-header">W</div>
    <div class="mini-cal-day-header">T</div>
    <div class="mini-cal-day-header">F</div>
    <div class="mini-cal-day-header">S</div>
    <div class="mini-cal-day-header">S</div>
  `;

  for (let i = 0; i < firstDayIndex; i++) {
    const emptyCell = document.createElement("div");
    emptyCell.className = "mini-cal-day-empty";
    miniCalendarGrid.append(emptyCell);
  }

  const todayNum = now.getDate();
  const monthStr = String(now.getMonth() + 1).padStart(2, "0");
  const yearStr = String(now.getFullYear());
  const selectedDateStr = state.currentView.startsWith("calendar:") ? state.currentView.slice(9) : null;

  for (let day = 1; day <= daysInMonth; day++) {
    const dayCell = document.createElement("div");
    dayCell.className = "mini-cal-day";
    dayCell.textContent = String(day);

    const fullDateStr = `${yearStr}-${monthStr}-${String(day).padStart(2, "0")}`;
    if (day === todayNum) {
      dayCell.classList.add("today");
    }
    if (selectedDateStr === fullDateStr) {
      dayCell.classList.add("active-date");
    }
    if (datesWithTasks.has(fullDateStr)) {
      dayCell.classList.add("has-tasks");
    }

    dayCell.addEventListener("click", () => {
      if (day === todayNum) {
        setView("today");
      } else {
        setView(`calendar:${fullDateStr}`);
      }
    });

    miniCalendarGrid.append(dayCell);
  }

  // 3. Up Next Deadlines
  let upcomingTasks = state.todos
    .filter((t) => !t.completed && t.dueDate && t.dueDate > getLocalDateString());

  if (state.currentView.startsWith("project:")) {
    const projId = state.currentView.slice(8);
    upcomingTasks = upcomingTasks.filter((t) => t.projectId === projId);
  }

  upcomingTasks = upcomingTasks
    .sort((a, b) => {
      const dateCmp = a.dueDate.localeCompare(b.dueDate);
      if (dateCmp !== 0) return dateCmp;
      const pRank = { high: 0, medium: 1, low: 2 };
      return pRank[a.priority] - pRank[b.priority];
    })
    .slice(0, 3);

  upNextCount.textContent = String(upcomingTasks.length);
  upNextList.innerHTML = "";

  if (upcomingTasks.length === 0) {
    const emptyLi = document.createElement("li");
    emptyLi.className = "rail-subtext";
    emptyLi.textContent = "No upcoming deadlines.";
    upNextList.append(emptyLi);
  } else {
    upcomingTasks.forEach((task) => {
      const li = document.createElement("li");
      li.className = "rail-task-item";
      li.innerHTML = `
        <span class="rail-task-title">${task.title}</span>
        <span class="rail-task-date">${formatDueDate(task.dueDate)}</span>
      `;
      li.addEventListener("click", () => {
        openTaskDetails(task.id);
      });
      upNextList.append(li);
    });
  }

  // 4. Projects Snapshot
  projectsSnapshotList.innerHTML = "";
  state.projects.slice(0, 4).forEach((proj) => {
    const totalProj = state.todos.filter((t) => t.projectId === proj.id).length;
    const doneProj = state.todos.filter((t) => t.projectId === proj.id && t.completed).length;
    const projPct = totalProj > 0 ? Math.round((doneProj / totalProj) * 100) : 0;

    const item = document.createElement("div");
    item.className = "proj-snapshot-item";
    item.innerHTML = `
      <div class="proj-snapshot-header">
        <span>${proj.name}</span>
        <span>${doneProj}/${totalProj}</span>
      </div>
      <div class="proj-snapshot-bar">
        <div class="proj-snapshot-fill" style="width: ${projPct}%; background-color: ${proj.color || "#f08352"};"></div>
      </div>
    `;
    item.style.cursor = "pointer";
    item.addEventListener("click", () => {
      setView(`project:${proj.id}`);
    });
    projectsSnapshotList.append(item);
  });
}

// ==========================================================================
// 22. CRUD ACTIONS, RECURRENCE LIFECYCLE & UNDO INTEGRATION
// ==========================================================================
function toggleTodo(id) {
  const todo = state.todos.find((t) => t.id === id);
  if (!todo) return;

  const willBeDone = !todo.completed;

  if (willBeDone) {
    state.completingTodoIds.add(id);

    const itemEl = document.querySelector(`.todo-item[data-id="${id}"]`);
    if (itemEl) {
      itemEl.classList.add("completing");
      const chk = itemEl.querySelector(".todo-toggle");
      if (chk) chk.checked = true;
    }

    setTimeout(() => {
      state.completingTodoIds.delete(id);

      let generatedNextOccurrence = null;
      const seriesId = todo.recurrenceSeriesId || (todo.recurrence !== "none" ? crypto.randomUUID() : null);

      // Recurrence Engine Handling
      if (todo.recurrence && todo.recurrence !== "none") {
        const nextDueDate = calculateNextDueDate(todo.dueDate || getLocalDateString(), todo.recurrence);
        const existingNext = state.todos.find(
          (t) => t.recurrenceSeriesId === seriesId && !t.completed && t.id !== id
        );

        if (!existingNext && nextDueDate) {
          generatedNextOccurrence = {
            id: crypto.randomUUID(),
            title: todo.title,
            description: todo.description,
            priority: todo.priority,
            dueDate: nextDueDate,
            dueTime: todo.dueTime,
            projectId: todo.projectId,
            tags: [...(todo.tags || [])],
            completed: false,
            createdAt: new Date().toISOString(),
            completedAt: null,
            subtasks: (todo.subtasks || []).map((s) => ({
              id: crypto.randomUUID(),
              title: s.title,
              completed: false,
              createdAt: new Date().toISOString()
            })),
            notes: todo.notes,
            reminder: todo.reminder,
            recurrence: todo.recurrence,
            recurrenceSeriesId: seriesId,
            generatedNextOccurrenceId: null
          };
        }
      }

      state.undoManager.push({
        type: "COMPLETE_TODO",
        todoId: id,
        previousCompleted: false,
        previousCompletedAt: todo.completedAt,
        generatedOccurrenceId: generatedNextOccurrence ? generatedNextOccurrence.id : null
      });

      let updatedTodos = state.todos.map((t) => {
        if (t.id === id) {
          return {
            ...t,
            completed: true,
            completedAt: new Date().toISOString(),
            recurrenceSeriesId: seriesId,
            generatedNextOccurrenceId: generatedNextOccurrence ? generatedNextOccurrence.id : t.generatedNextOccurrenceId
          };
        }
        return t;
      });

      if (generatedNextOccurrence) {
        updatedTodos = [generatedNextOccurrence, ...updatedTodos];
      }

      state.todos = updatedTodos;
      DataStore.saveTodos(state.todos);
      render();

      if (state.activeDrawerTodoId === id) {
        const updated = state.todos.find((t) => t.id === id);
        if (updated) updateDrawerStatusButton(updated);
      }

      const toastMsg = generatedNextOccurrence
        ? `Completed. Next occurrence scheduled for ${formatDueDate(generatedNextOccurrence.dueDate)}`
        : "Task completed 🎉";

      showToast(toastMsg, 3500, () => {
        state.undoManager.undo();
      });
    }, 320);
  } else {
    state.undoManager.push({
      type: "COMPLETE_TODO",
      todoId: id,
      previousCompleted: true,
      previousCompletedAt: todo.completedAt,
      generatedOccurrenceId: null
    });

    state.todos = state.todos.map((t) => {
      if (t.id === id) {
        return {
          ...t,
          completed: false,
          completedAt: null
        };
      }
      return t;
    });

    DataStore.saveTodos(state.todos);
    render();

    if (state.activeDrawerTodoId === id) {
      const updated = state.todos.find((t) => t.id === id);
      if (updated) updateDrawerStatusButton(updated);
    }

    showToast("Task marked incomplete", 2500, () => {
      state.undoManager.undo();
    });
  }
}

function deleteTodo(id) {
  const index = state.todos.findIndex((t) => t.id === id);
  if (index === -1) return;

  const todo = state.todos[index];

  state.undoManager.push({
    type: "DELETE_TODO",
    todo: { ...todo },
    index
  });

  state.todos = state.todos.filter((t) => t.id !== id);
  DataStore.saveTodos(state.todos);
  render();

  showToast(`Deleted "${todo.title}"`, 3500, () => {
    state.undoManager.undo();
  });
}

function clearCompleted() {
  const completedTodos = state.todos.filter((t) => t.completed);
  if (completedTodos.length === 0) {
    showToast("No completed tasks to clear.", 2000);
    return;
  }

  if (window.confirm(`Clear ${completedTodos.length} completed task${completedTodos.length === 1 ? "" : "s"}?`)) {
    state.undoManager.push({
      type: "CLEAR_COMPLETED",
      clearedTodos: [...completedTodos]
    });

    state.todos = state.todos.filter((todo) => !todo.completed);
    DataStore.saveTodos(state.todos);
    render();

    showToast(`Cleared ${completedTodos.length} completed task${completedTodos.length === 1 ? "" : "s"}.`, 3500, () => {
      state.undoManager.undo();
    });
  }
}

function setView(viewName) {
  state.currentView = viewName;

  if (viewName.startsWith("project:")) {
    const projId = viewName.slice(8);
    projectInput.value = projId;
    mobileProjectInput.value = projId;
  } else {
    projectInput.value = "";
    mobileProjectInput.value = "";
  }

  if (viewName === "today") {
    dueDateInput.value = getLocalDateString();
    mobileDueDateInput.value = getLocalDateString();
  } else if (viewName.startsWith("calendar:")) {
    const calDate = viewName.slice(9);
    dueDateInput.value = calDate;
    mobileDueDateInput.value = calDate;
  } else {
    dueDateInput.value = "";
    mobileDueDateInput.value = "";
  }

  closeMobileSidebar();
  render();
}

function openMobileSidebar() {
  appSidebar.classList.add("open");
  sidebarOverlay.classList.add("active");
}

function closeMobileSidebar() {
  appSidebar.classList.remove("open");
  sidebarOverlay.classList.remove("active");
}

function openMobileBottomSheet() {
  if (state.currentView === "today") {
    mobileDueDateInput.value = getLocalDateString();
  } else if (state.currentView.startsWith("calendar:")) {
    mobileDueDateInput.value = state.currentView.slice(9);
  }
  if (state.currentView.startsWith("project:")) {
    mobileProjectInput.value = state.currentView.slice(8);
  }
  mobileComposerSheet.classList.add("open");
  mobileTodoInput.focus();
}

function closeMobileBottomSheet() {
  mobileComposerSheet.classList.remove("open");
  mobileTodoForm.reset();
}

// ==========================================================================
// 23. COMMAND PALETTE (⌘K / Ctrl+K)
// ==========================================================================
function openCommandPalette() {
  if (!commandPaletteOverlay || !cmdPaletteInput) return;

  state.lastFocusedElement = document.activeElement;
  cmdPaletteInput.value = "";
  state.cmdPaletteSelectedIndex = 0;

  commandPaletteOverlay.classList.add("active");
  commandPaletteOverlay.setAttribute("aria-hidden", "false");
  cmdPaletteInput.focus();

  renderCommandPaletteResults("");
}

function closeCommandPalette() {
  if (!commandPaletteOverlay) return;

  commandPaletteOverlay.classList.remove("active");
  commandPaletteOverlay.setAttribute("aria-hidden", "true");

  if (state.lastFocusedElement && typeof state.lastFocusedElement.focus === "function") {
    state.lastFocusedElement.focus();
  }
}

function renderCommandPaletteResults(query = "") {
  if (!cmdPaletteResults) return;

  const needle = query.trim().toLowerCase();
  const items = [];

  // Navigation Items
  const navDefs = [
    { title: "Today’s Board", meta: "View", icon: "sun", action: () => setView("today") },
    { title: "Inbox", meta: "View", icon: "inbox", action: () => setView("inbox") },
    { title: "Upcoming", meta: "View", icon: "calendar", action: () => setView("upcoming") },
    { title: "Calendar", meta: "View", icon: "calendar", action: () => setView("calendar") },
    { title: "Completed", meta: "View", icon: "check", action: () => setView("completed") },
    { title: "Overdue", meta: "View", icon: "alert", action: () => setView("overdue") }
  ];

  const matchedNav = navDefs.filter((n) => !needle || n.title.toLowerCase().includes(needle));

  // Quick Action Items
  const actionDefs = [
    {
      title: "New Task",
      meta: "Action",
      icon: "plus",
      action: () => {
        if (window.innerWidth <= 767) {
          openMobileBottomSheet();
        } else {
          expandComposer();
          todoInput.focus();
        }
      }
    },
    { title: "New Project", meta: "Action", icon: "folder-plus", action: () => openProjectModal(null) },
    { title: "Clear Completed Tasks", meta: "Action", icon: "trash", action: () => clearCompleted() },
    { title: "Toggle Theme (Dark / Light)", meta: "Action", icon: "moon", action: () => toggleTheme() },
    { title: "Export Backup (JSON)", meta: "Action", icon: "download", action: () => DataStore.exportData() },
    { title: "Show Keyboard Shortcuts", meta: "Help", icon: "help", action: () => openShortcutsModal() }
  ];

  if (AuthManager.isAuthenticated()) {
    actionDefs.push(
      { title: "Manage Account (Clerk Profile)", meta: "Account", icon: "user", action: () => AuthManager.openAccountManagement() },
      { title: "Sign Out", meta: "Account", icon: "log-out", action: () => AuthManager.signOut() }
    );
  } else {
    actionDefs.push(
      { title: "Sign In / Create Account", meta: "Account", icon: "log-in", action: () => AuthManager.openSignIn() }
    );
  }

  const matchedActions = actionDefs.filter((a) => !needle || a.title.toLowerCase().includes(needle));

  // Project Items
  const matchedProjects = state.projects
    .filter((p) => !needle || p.name.toLowerCase().includes(needle))
    .map((p) => ({
      title: `Project: ${p.name}`,
      meta: "Project",
      icon: "folder",
      color: p.color,
      action: () => setView(`project:${p.id}`)
    }));

  // Matching Tasks
  const matchedTasks = state.todos
    .filter((t) => needle && matchesAdvancedSearch(t, needle))
    .slice(0, 8)
    .map((t) => ({
      title: t.title,
      meta: t.dueDate ? formatDueDate(t.dueDate) : (t.completed ? "Done" : "Open"),
      icon: "task",
      action: () => openTaskDetails(t.id)
    }));

  cmdPaletteResults.innerHTML = "";

  const sections = [];
  if (matchedActions.length > 0) sections.push({ group: "Actions", items: matchedActions });
  if (matchedNav.length > 0) sections.push({ group: "Navigation", items: matchedNav });
  if (matchedProjects.length > 0) sections.push({ group: "Projects", items: matchedProjects });
  if (matchedTasks.length > 0) sections.push({ group: "Tasks", items: matchedTasks });

  let flatIndex = 0;
  state.cmdPaletteItems = [];

  if (sections.length === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "cmd-item";
    emptyDiv.style.cursor = "default";
    emptyDiv.innerHTML = `<span style="color: var(--muted);">No commands or tasks found</span>`;
    cmdPaletteResults.appendChild(emptyDiv);
    return;
  }

  sections.forEach((sec) => {
    const groupTitle = document.createElement("div");
    groupTitle.className = "cmd-group-title";
    groupTitle.textContent = sec.group;
    cmdPaletteResults.appendChild(groupTitle);

    sec.items.forEach((item) => {
      const idx = flatIndex++;
      state.cmdPaletteItems.push(item);

      const div = document.createElement("div");
      div.className = `cmd-item${idx === state.cmdPaletteSelectedIndex ? " selected" : ""}`;
      div.dataset.index = String(idx);

      div.innerHTML = `
        <div class="cmd-item-left">
          ${item.color ? `<span class="project-dot" style="background:${item.color};"></span>` : ""}
          <span class="cmd-item-title">${item.title}</span>
        </div>
        <span class="cmd-item-meta">${item.meta}</span>
      `;

      div.addEventListener("click", () => {
        closeCommandPalette();
        item.action();
      });

      div.addEventListener("mouseenter", () => {
        state.cmdPaletteSelectedIndex = idx;
        updateCommandPaletteSelection();
      });

      cmdPaletteResults.appendChild(div);
    });
  });

  if (state.cmdPaletteSelectedIndex >= state.cmdPaletteItems.length) {
    state.cmdPaletteSelectedIndex = 0;
  }
  updateCommandPaletteSelection();
}

function updateCommandPaletteSelection() {
  const resultItems = cmdPaletteResults.querySelectorAll(".cmd-item");
  resultItems.forEach((el, idx) => {
    const isSel = idx === state.cmdPaletteSelectedIndex;
    el.classList.toggle("selected", isSel);
    if (isSel) {
      el.scrollIntoView({ block: "nearest" });
    }
  });
}

function setupCommandPaletteListeners() {
  if (!cmdPaletteInput || !commandPaletteOverlay) return;

  cmdPaletteInput.addEventListener("input", (e) => {
    state.cmdPaletteSelectedIndex = 0;
    renderCommandPaletteResults(e.target.value);
  });

  cmdPaletteInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (state.cmdPaletteItems.length > 0) {
        state.cmdPaletteSelectedIndex = (state.cmdPaletteSelectedIndex + 1) % state.cmdPaletteItems.length;
        updateCommandPaletteSelection();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (state.cmdPaletteItems.length > 0) {
        state.cmdPaletteSelectedIndex = (state.cmdPaletteSelectedIndex - 1 + state.cmdPaletteItems.length) % state.cmdPaletteItems.length;
        updateCommandPaletteSelection();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = state.cmdPaletteItems[state.cmdPaletteSelectedIndex];
      if (selected) {
        closeCommandPalette();
        selected.action();
      }
    } else if (e.key === "Escape") {
      closeCommandPalette();
    }
  });

  commandPaletteOverlay.addEventListener("click", (e) => {
    if (e.target === commandPaletteOverlay) {
      closeCommandPalette();
    }
  });

  const shortcutHint = document.querySelector(".shortcut-hint");
  if (shortcutHint) {
    shortcutHint.style.cursor = "pointer";
    shortcutHint.addEventListener("click", openCommandPalette);
  }
}

// ==========================================================================
// 24. KEYBOARD SHORTCUTS ENGINE & HELP MODAL (?)
// ==========================================================================
function openShortcutsModal() {
  state.lastFocusedElement = document.activeElement;
  shortcutsModalOverlay.classList.add("active");
  shortcutsModalOverlay.setAttribute("aria-hidden", "false");
}

function closeShortcutsModal() {
  shortcutsModalOverlay.classList.remove("active");
  shortcutsModalOverlay.setAttribute("aria-hidden", "true");
  if (state.lastFocusedElement && typeof state.lastFocusedElement.focus === "function") {
    state.lastFocusedElement.focus();
  }
}

function setupShortcutsModalListeners() {
  if (!shortcutsModalOverlay || !closeShortcutsModalBtn) return;

  closeShortcutsModalBtn.addEventListener("click", closeShortcutsModal);
  shortcutsModalOverlay.addEventListener("click", (e) => {
    if (e.target === shortcutsModalOverlay) closeShortcutsModal();
  });
}

function isTypingInInput(el) {
  if (!el) return false;
  const tag = el.tagName;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(tag) || el.isContentEditable;
}

function setupGlobalShortcuts() {
  window.addEventListener("keydown", (e) => {
    // 1. Command Palette: ⌘K or Ctrl+K
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (commandPaletteOverlay.classList.contains("active")) {
        closeCommandPalette();
      } else {
        openCommandPalette();
      }
      return;
    }

    // 2. Global Escape: closes active overlays
    if (e.key === "Escape") {
      closeCommandPalette();
      closeShortcutsModal();
      AuthManager.closeSignInModal();
      closeTaskDetails();
      closeProjectModal();
      closeContextMenu();
      closeMobileSidebar();
      closeMobileBottomSheet();
      if (userProfileWrap) {
        userProfileWrap.classList.remove("open");
      }
      return;
    }

    // 3. Undo: ⌘Z or Ctrl+Z (when not typing in form inputs)
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      if (!isTypingInInput(document.activeElement)) {
        e.preventDefault();
        state.undoManager.undo();
        return;
      }
    }

    // 4. Single-key shortcuts (Suppressed when typing in input/textarea/select)
    if (isTypingInInput(document.activeElement)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key;

    if (key === "n" || key === "N") {
      e.preventDefault();
      if (window.innerWidth <= 767) {
        openMobileBottomSheet();
      } else {
        expandComposer();
        todoInput.focus();
      }
    } else if (key === "/") {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    } else if (key === "t" || key === "T") {
      e.preventDefault();
      setView("today");
    } else if (key === "i" || key === "I") {
      e.preventDefault();
      setView("inbox");
    } else if (key === "u" || key === "U") {
      e.preventDefault();
      setView("upcoming");
    } else if (key === "c" || key === "C") {
      e.preventDefault();
      setView("calendar");
    } else if (key === "?") {
      e.preventDefault();
      openShortcutsModal();
    }
  });
}

// ==========================================================================
// 25. IN-APP REMINDER FOUNDATION (Periodic In-App Alerts)
// ==========================================================================
function checkReminders() {
  const now = new Date();
  const currentIso = now.toISOString();
  const todayStr = getLocalDateString(now);

  state.todos.forEach((todo) => {
    if (todo.completed || !todo.dueDate || !todo.reminder) return;
    if (state.triggeredReminders.has(todo.id)) return;

    const offsetMinutes = parseInt(todo.reminder, 10);
    if (isNaN(offsetMinutes)) return;

    // Calculate target date & time
    const timeStr = todo.dueTime || "09:00";
    const [year, month, day] = todo.dueDate.split("-").map(Number);
    const [hh, mm] = timeStr.split(":").map(Number);

    const targetDate = new Date(year, month - 1, day, hh, mm, 0, 0);
    const reminderTime = new Date(targetDate.getTime() - offsetMinutes * 60 * 1000);

    if (now >= reminderTime) {
      state.triggeredReminders.add(todo.id);
      showToast(`⏰ Reminder: "${todo.title}" is due ${formatDueDate(todo.dueDate, todo.dueTime)}`, 5000);
    }
  });
}

// ==========================================================================
// 26. TASK CREATION FORM LISTENERS
// ==========================================================================
function setupTaskCreationListeners() {
  // Desktop Task Creation
  todoForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const title = todoInput.value.trim();
    if (!title) return;

    const priority = priorityInput.value;
    const dueDate = dueDateInput.value;
    const dueTime = dueTimeInput.value;
    const projectId = projectInput.value || null;
    const rawTags = tagsInput.value;

    const tags = normalizeTags(rawTags.split(","));

    const newTodo = {
      id: crypto.randomUUID(),
      title,
      description: "",
      priority,
      dueDate,
      dueTime,
      projectId,
      tags,
      completed: false,
      createdAt: new Date().toISOString(),
      completedAt: null,
      subtasks: [],
      notes: "",
      reminder: null,
      recurrence: "none",
      recurrenceSeriesId: null,
      generatedNextOccurrenceId: null
    };

    state.todos = [newTodo, ...state.todos];
    DataStore.saveTodos(state.todos);

    todoForm.reset();
    priorityInput.value = "medium";
    if (state.currentView === "today") {
      dueDateInput.value = getLocalDateString();
    } else if (state.currentView.startsWith("calendar:")) {
      dueDateInput.value = state.currentView.slice(9);
    }
    if (state.currentView.startsWith("project:")) {
      projectInput.value = state.currentView.slice(8);
    }

    collapseComposer();
    render();
    showToast("Task created", 2000);
  });

  // Mobile Task Creation (Bottom Sheet)
  mobileTodoForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const title = mobileTodoInput.value.trim();
    if (!title) return;

    const priority = mobilePriorityInput.value;
    const dueDate = mobileDueDateInput.value;
    const dueTime = mobileDueTimeInput.value;
    const projectId = mobileProjectInput.value || null;
    const rawTags = mobileTagsInput.value;

    const tags = normalizeTags(rawTags.split(","));

    const newTodo = {
      id: crypto.randomUUID(),
      title,
      description: "",
      priority,
      dueDate,
      dueTime,
      projectId,
      tags,
      completed: false,
      createdAt: new Date().toISOString(),
      completedAt: null,
      subtasks: [],
      notes: "",
      reminder: null,
      recurrence: "none",
      recurrenceSeriesId: null,
      generatedNextOccurrenceId: null
    };

    state.todos = [newTodo, ...state.todos];
    DataStore.saveTodos(state.todos);

    closeMobileBottomSheet();
    render();
    showToast("Task created", 2000);
  });

  if (mobileAddBtn) {
    mobileAddBtn.addEventListener("click", openMobileBottomSheet);
  }
  if (bottomSheetBackdrop) {
    bottomSheetBackdrop.addEventListener("click", closeMobileBottomSheet);
  }
  if (closeBottomSheetBtn) {
    closeBottomSheetBtn.addEventListener("click", closeMobileBottomSheet);
  }

  // Search Input
  searchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });

  // Sorting Select
  if (sortSelect) {
    sortSelect.value = state.sort;
    sortSelect.addEventListener("change", (e) => {
      state.sort = e.target.value;
      DataStore.saveSortPreference(state.sort);
      render();
    });
  }

  // Status Filter Tabs
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      filterButtons.forEach((btn) => {
        const active = btn === button;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", String(active));
      });
      render();
    });
  });

  // Clear Completed
  clearCompletedBtn.addEventListener("click", clearCompleted);

  // Sidebar & Bottom Nav View Clicks
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const view = item.dataset.view;
      if (view) setView(view);
    });
  });

  // Mobile Sidebar Controls
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener("click", openMobileSidebar);
  }
  if (mobileMenuMoreBtn) {
    mobileMenuMoreBtn.addEventListener("click", openMobileSidebar);
  }
  if (sidebarCloseBtn) {
    sidebarCloseBtn.addEventListener("click", closeMobileSidebar);
  }
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener("click", closeMobileSidebar);
  }

  // Theme Switcher Buttons
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", toggleTheme);
  }
  if (mobileThemeToggleBtn) {
    mobileThemeToggleBtn.addEventListener("click", toggleTheme);
  }
}

// ==========================================================================
// 27. LIGHTWEIGHT NATIVE WEBGL ATMOSPHERIC SHADER ENGINE
// ==========================================================================
class AmbientCanvas {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;

    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.gl = this.canvas.getContext("webgl", { alpha: true, powerPreference: "low-power" });
    if (!this.gl) {
      console.warn("WebGL not supported; defaulting to CSS atmosphere.");
      return;
    }

    this.mouse = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 };
    this.time = 0;
    this.isRunning = false;
    this.animationFrameId = null;

    this.init();
  }

  init() {
    const gl = this.gl;

    const vsSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        v_uv = (a_position + 1.0) * 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fsSource = `
      precision mediump float;
      uniform vec2 u_resolution;
      uniform vec2 u_mouse;
      uniform float u_time;
      uniform float u_is_dark;
      varying vec2 v_uv;

      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution;
        vec2 mouse = u_mouse;

        float t = u_time * 0.12;
        
        vec2 p1 = vec2(0.25 + 0.15 * sin(t * 0.6), 0.75 + 0.15 * cos(t * 0.5));
        p1 += (mouse - 0.5) * 0.08;
        float d1 = length(uv - p1);
        float w1 = smoothstep(0.85, 0.0, d1);

        vec2 p2 = vec2(0.8 + 0.12 * cos(t * 0.7), 0.25 + 0.12 * sin(t * 0.4));
        p2 += (mouse - 0.5) * 0.06;
        float d2 = length(uv - p2);
        float w2 = smoothstep(0.75, 0.0, d2);

        vec2 p3 = vec2(0.5 + 0.2 * sin(t * 0.3), 0.5 + 0.15 * cos(t * 0.4));
        float d3 = length(uv - p3);
        float w3 = smoothstep(0.9, 0.0, d3);

        vec3 darkBase = vec3(0.07, 0.06, 0.055);
        vec3 darkOrange = vec3(0.94, 0.51, 0.32);
        vec3 darkAmber = vec3(0.84, 0.64, 0.29);
        vec3 darkGreen = vec3(0.31, 0.62, 0.46);

        vec3 lightBase = vec3(0.96, 0.94, 0.91);
        vec3 lightOrange = vec3(0.85, 0.42, 0.25);
        vec3 lightAmber = vec3(0.72, 0.47, 0.14);
        vec3 lightGreen = vec3(0.18, 0.49, 0.35);

        vec3 base = mix(lightBase, darkBase, u_is_dark);
        vec3 cOrange = mix(lightOrange, darkOrange, u_is_dark);
        vec3 cAmber = mix(lightAmber, darkAmber, u_is_dark);
        vec3 cGreen = mix(lightGreen, darkGreen, u_is_dark);

        vec3 col = base;
        col += cOrange * (w1 * (u_is_dark > 0.5 ? 0.28 : 0.14));
        col += cGreen * (w2 * (u_is_dark > 0.5 ? 0.18 : 0.08));
        col += cAmber * (w3 * (u_is_dark > 0.5 ? 0.14 : 0.06));

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const program = this.createProgram(gl, vsSource, fsSource);
    if (!program) return;
    this.program = program;

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const positionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    this.uResolution = gl.getUniformLocation(program, "u_resolution");
    this.uMouse = gl.getUniformLocation(program, "u_mouse");
    this.uTime = gl.getUniformLocation(program, "u_time");
    this.uIsDark = gl.getUniformLocation(program, "u_is_dark");

    this.resize();
    window.addEventListener("resize", () => this.resize());

    window.addEventListener("mousemove", (e) => {
      this.mouse.targetX = e.clientX / window.innerWidth;
      this.mouse.targetY = 1.0 - e.clientY / window.innerHeight;
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.stop();
      } else if (!this.reducedMotion) {
        this.start();
      }
    });

    if (this.reducedMotion) {
      this.renderStatic();
    } else {
      this.start();
    }
  }

  createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  createProgram(gl, vsSource, fsSource) {
    const vs = this.createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = this.createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn(gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  resize() {
    if (!this.canvas || !this.gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.floor(window.innerWidth * dpr);
    const height = Math.floor(window.innerHeight * dpr);

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    let lastTime = performance.now();

    const loop = (currentTime) => {
      if (!this.isRunning) return;
      const delta = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      this.time += delta;
      this.mouse.x += (this.mouse.targetX - this.mouse.x) * 0.04;
      this.mouse.y += (this.mouse.targetY - this.mouse.y) * 0.04;

      this.draw();
      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  renderStatic() {
    this.time = 1.0;
    this.draw();
  }

  draw() {
    const gl = this.gl;
    if (!gl || !this.program) return;

    gl.useProgram(this.program);
    gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uMouse, this.mouse.x, this.mouse.y);
    gl.uniform1f(this.uTime, this.time);

    const isDark = document.documentElement.getAttribute("data-theme") === "dark" ? 1.0 : 0.0;
    gl.uniform1f(this.uIsDark, isDark);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

// ==========================================================================
// 28. INITIALIZATION
// ==========================================================================
applyTheme(state.theme);
setupComposerInteractions();
setupStatCards();
setupUserProfileMenu();
setupDrawerListeners();
setupProjectModalListeners();
setupContextMenuListeners();
setupCalendarNavListeners();
setupCommandPaletteListeners();
setupShortcutsModalListeners();
setupGlobalShortcuts();
setupTaskCreationListeners();
AuthManager.init();

// Start In-App Reminder Polling every 30 seconds
setInterval(checkReminders, 30000);
checkReminders();

if (state.currentView === "today") {
  dueDateInput.value = getLocalDateString();
  mobileDueDateInput.value = getLocalDateString();
}

render();

// Initialize Ambient WebGL Canvas
const ambientCanvas = new AmbientCanvas("ambientCanvas");
