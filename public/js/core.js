/**
 * Momentum — Undo manager, DOM references, app state, toasts, theme, date/sort helpers.
 * Classic script: shares global scope with the other files in /js, loaded in order by index.html.
 */

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
      if (!WorkspaceRepository.isCloud()) {
        LocalDataStore.saveTodos(state.todos);
      }
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
      if (!WorkspaceRepository.isCloud()) {
        LocalDataStore.saveTodos(state.todos);
      }
      render();
      showToast("Completion undone", 2000);
      return true;
    } else if (action.type === "DELETE_PROJECT") {
      const { project, affectedTodoIds } = action;
      state.projects.push(project);
      state.todos = state.todos.map((t) =>
        affectedTodoIds.includes(t.id) ? { ...t, projectId: project.id } : t
      );
      if (!WorkspaceRepository.isCloud()) {
        LocalDataStore.saveProjects(state.projects);
        LocalDataStore.saveTodos(state.todos);
      }
      render();
      showToast(`Restored project "${project.name}"`, 2500);
      return true;
    } else if (action.type === "CLEAR_COMPLETED") {
      const { clearedTodos } = action;
      state.todos = [...clearedTodos, ...state.todos];
      if (!WorkspaceRepository.isCloud()) {
        LocalDataStore.saveTodos(state.todos);
      }
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
const menuEditProfileBtn = document.querySelector("#menuEditProfileBtn");
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

// Display Name Onboarding & Profile Editor Modals
const displayNameModalOverlay = document.querySelector("#displayNameModalOverlay");
const dnModalInput = document.querySelector("#dnModalInput");
const dnModalSubmitBtn = document.querySelector("#dnModalSubmitBtn");
const dnModalSpinner = document.querySelector("#dnModalSpinner");
const dnModalError = document.querySelector("#dnModalError");

const profileEditorOverlay = document.querySelector("#profileEditorOverlay");
const profileEditorCloseBtn = document.querySelector("#profileEditorCloseBtn");
const profileEditorCancelBtn = document.querySelector("#profileEditorCancelBtn");
const profileEditorSaveBtn = document.querySelector("#profileEditorSaveBtn");
const profileEditorSpinner = document.querySelector("#profileEditorSpinner");
const profileEditorError = document.querySelector("#profileEditorError");
const profileEditorNameInput = document.querySelector("#profileEditorNameInput");
const profileEditorEmailDisplay = document.querySelector("#profileEditorEmailDisplay");


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
const initialProjects = LocalDataStore.getProjects();
const initialNow = new Date();

let state = {
  currentView: "today", // 'today' | 'inbox' | 'upcoming' | 'calendar' | 'calendar:<YYYY-MM-DD>' | 'completed' | 'overdue' | 'project:<id>' | 'tag:<tag>'
  filter: "all",        // 'all' | 'open' | 'done'
  sort: LocalDataStore.getSortPreference(), // 'smart' | 'dueDate' | 'priority' | 'newest' | 'oldest'
  search: "",
  theme: LocalDataStore.getTheme(),
  projects: initialProjects,
  todos: LocalDataStore.getTodos(initialProjects),
  activeDrawerTodoId: null,
  activeContextMenuTodoId: null,
  completingTodoIds: new Set(),
  lastFocusedElement: null,

  // Workspace Mode & Cloud State (Stage 4D)
  workspaceMode: "local", // 'local' | 'cloud'
  cloudStatus: "idle",    // 'idle' | 'loading' | 'connected' | 'error'
  cloudError: null,
  cloudSettingsVersion: 1,

  // Calendar State
  calendarDate: { year: initialNow.getFullYear(), month: initialNow.getMonth() }, // 0-indexed month
  selectedCalendarDate: getLocalDateString(initialNow),

  // Command Palette State
  cmdPaletteSelectedIndex: 0,
  cmdPaletteItems: [],

  // Undo System
  undoManager: new UndoManager(),

  // Reminder Tracking
  triggeredReminders: new Set(),

  // True while the first paint is waiting on auth (see AuthManager.paintBootHint)
  booting: false
};

// ==========================================================================
// 8. TOAST NOTIFICATION & UNDO SYSTEM
// ==========================================================================
function showToast(message, duration = 3000, undoCallback = null, icon = null) {
  if (!toastContainer) return;

  const toast = document.createElement("div");
  toast.className = "toast";

  if (icon) {
    const iconWrap = document.createElement("span");
    iconWrap.className = `toast-icon toast-icon-${icon}`;
    iconWrap.appendChild(iconEl(icon, 16));
    toast.appendChild(iconWrap);
  }

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
function applyTheme(theme, persist = true) {
  state.theme = theme;
  if (persist) {
    WorkspaceRepository.updateTheme(theme);
  }

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
  applyTheme(nextTheme, true);
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
