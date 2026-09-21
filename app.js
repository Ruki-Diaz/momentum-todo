/**
 * Momentum Todo V2 — Core Application & Ambient WebGL Engine
 * Pure Vanilla JavaScript (ES6+)
 * Calm, Cinematic, Editorial, Offline-First
 */

// ==========================================================================
// 1. CONSTANTS & DEFAULT DATA
// ==========================================================================
const STORAGE_KEY = "momentum-todos-v1";
const STORAGE_PROJECTS_KEY = "momentum-projects-v1";
const STORAGE_THEME_KEY = "momentum-theme";

const DEFAULT_PROJECTS = [
  { id: "work", name: "Work", color: "#f08352" },
  { id: "personal", name: "Personal", color: "#4e9d75" },
  { id: "university", name: "University", color: "#d7a34b" },
  { id: "finance", name: "Finance", color: "#a569bd" }
];

// ==========================================================================
// 2. DATASTORE ABSTRACTION LAYER (Centralized Storage & Cloud-Sync Ready)
// ==========================================================================
const DataStore = {
  getTodos() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeTodo).filter(Boolean);
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

  getProjects() {
    try {
      const raw = localStorage.getItem(STORAGE_PROJECTS_KEY);
      if (!raw) return [...DEFAULT_PROJECTS];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_PROJECTS];
      return parsed;
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

/**
 * Normalizes any task object (legacy or new) to guarantee backward compatibility and schema stability.
 */
function normalizeTodo(raw) {
  if (!raw || typeof raw !== "object") return null;

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
    title: typeof raw.title === "string" ? raw.title.trim() : "",
    description: typeof raw.description === "string" ? raw.description : "",
    priority: ["high", "medium", "low"].includes(raw.priority) ? raw.priority : "medium",
    dueDate: typeof raw.dueDate === "string" ? raw.dueDate : "",
    dueTime: typeof raw.dueTime === "string" ? raw.dueTime : "",
    project: typeof raw.project === "string" ? raw.project : "",
    tags: Array.isArray(raw.tags)
      ? raw.tags
          .map((t) => String(t).trim().toLowerCase())
          .filter((t) => t.length > 0)
      : [],
    completed: Boolean(raw.completed),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    completedAt: raw.completed
      ? typeof raw.completedAt === "string" && raw.completedAt
        ? raw.completedAt
        : raw.createdAt || new Date().toISOString()
      : "",
    subtasks: Array.isArray(raw.subtasks)
      ? raw.subtasks.map((s) => ({
          id: s.id || crypto.randomUUID(),
          title: typeof s.title === "string" ? s.title.trim() : "",
          completed: Boolean(s.completed)
        }))
      : [],
    notes: typeof raw.notes === "string" ? raw.notes : "",
    reminder: typeof raw.reminder === "string" ? raw.reminder : "",
    recurrence: ["none", "daily", "weekdays", "weekly", "monthly"].includes(raw.recurrence)
      ? raw.recurrence
      : "none"
  };
}

function createTodo(title, priority, dueDate, dueTime, project, tags) {
  return normalizeTodo({
    id: crypto.randomUUID(),
    title,
    description: "",
    priority,
    dueDate,
    dueTime,
    project,
    tags,
    completed: false,
    createdAt: new Date().toISOString(),
    completedAt: "",
    subtasks: [],
    notes: "",
    reminder: "",
    recurrence: "none"
  });
}

// ==========================================================================
// 3. DOM ELEMENTS
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
const menuToggleThemeBtn = document.querySelector("#menuToggleThemeBtn");
const menuExportDataBtn = document.querySelector("#menuExportDataBtn");
const menuClearCompletedBtn = document.querySelector("#menuClearCompletedBtn");

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

const searchInput = document.querySelector("#searchInput");
const clearCompletedBtn = document.querySelector("#clearCompletedBtn");
const filterButtons = document.querySelectorAll(".filter-chip");
const navItems = document.querySelectorAll(".nav-item, .mobile-nav-btn:not(#mobileAddBtn):not(#mobileMenuMoreBtn)");

const sectionHeader = document.querySelector("#sectionHeader");
const sectionSubheader = document.querySelector("#sectionSubheader");
const summaryText = document.querySelector("#summaryText");
const todoList = document.querySelector("#todoList");
const emptyStateTemplate = document.querySelector("#emptyStateTemplate");

// Secondary Desktop Rail Elements
const workspaceRail = document.querySelector("#workspaceRail");
const railWeeklyCard = document.querySelector("#railWeeklyCard");
const weeklyPercent = document.querySelector("#weeklyPercent");
const weeklyProgressBar = document.querySelector("#weeklyProgressBar");
const weeklySummary = document.querySelector("#weeklySummary");

const railCalendarCard = document.querySelector("#railCalendarCard");
const miniCalendarMonth = document.querySelector("#miniCalendarMonth");
const miniCalendarToday = document.querySelector("#miniCalendarToday");
const miniCalendarGrid = document.querySelector("#miniCalendarGrid");

const railUpNextCard = document.querySelector("#railUpNextCard");
const upNextCount = document.querySelector("#upNextCount");
const upNextList = document.querySelector("#upNextList");

const railProjectsCard = document.querySelector("#railProjectsCard");
const projectsSnapshotList = document.querySelector("#projectsSnapshotList");

const toastContainer = document.querySelector("#toastContainer");

// ==========================================================================
// 4. APPLICATION STATE
// ==========================================================================
let state = {
  currentView: "today", // 'today' | 'inbox' | 'upcoming' | 'calendar' | 'calendar:<YYYY-MM-DD>' | 'completed' | 'overdue' | 'project:<id>' | 'tag:<tag>'
  filter: "all",        // 'all' | 'open' | 'done'
  search: "",
  theme: DataStore.getTheme(),
  todos: DataStore.getTodos(),
  projects: DataStore.getProjects(),
  completingTodoIds: new Set()
};

// ==========================================================================
// 5. TOAST NOTIFICATION SYSTEM
// ==========================================================================
function showToast(message, duration = 3000) {
  if (!toastContainer) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span>${message}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-fade-out");
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 240);
  }, duration);
}

// ==========================================================================
// 6. THEME MANAGEMENT
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
// 7. DATE & TIME UTILITIES
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
// 8. STREAK & STATS CALCULATIONS
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
// 9. SMART 2-STATE TASK COMPOSER
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

  // Expand when user focuses or starts typing in the main input
  todoInput.addEventListener("focus", expandComposer);
  todoInput.addEventListener("input", expandComposer);
  if (composerOptionsRow) {
    composerOptionsRow.addEventListener("click", expandComposer);
  }

  // Auto-collapse when user clicks outside, unless input has text or options are modified
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
// 10. CLICKABLE STAT CARDS SETUP
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

// ==========================================================================
// 11. USER PROFILE & ACCOUNT MENU SETUP
// ==========================================================================
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
// 12. VIEW & FILTER LOGIC
// ==========================================================================
function getVisibleTodos() {
  return state.todos.filter((todo) => {
    let matchesView = true;

    if (state.currentView === "today") {
      matchesView = isToday(todo) || (isOverdue(todo) && !todo.completed);
    } else if (state.currentView === "inbox") {
      matchesView = !todo.project;
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
      matchesView = todo.project === projectId;
    } else if (state.currentView.startsWith("tag:")) {
      const tag = state.currentView.slice(4).toLowerCase();
      matchesView = todo.tags.includes(tag);
    }

    if (!matchesView) return false;

    const matchesFilter =
      state.filter === "all" ||
      (state.filter === "open" && !todo.completed) ||
      (state.filter === "done" && todo.completed);

    if (!matchesFilter) return false;

    const searchNeedle = state.search.trim().toLowerCase();
    if (!searchNeedle) return true;

    const projectObj = state.projects.find((p) => p.id === todo.project);
    const projectName = projectObj ? projectObj.name.toLowerCase() : "";
    const formattedDate = formatDueDate(todo.dueDate, todo.dueTime).toLowerCase();

    return (
      todo.title.toLowerCase().includes(searchNeedle) ||
      todo.description.toLowerCase().includes(searchNeedle) ||
      todo.priority.toLowerCase().includes(searchNeedle) ||
      projectName.includes(searchNeedle) ||
      formattedDate.includes(searchNeedle) ||
      todo.tags.some((t) => t.includes(searchNeedle)) ||
      todo.notes.toLowerCase().includes(searchNeedle)
    );
  });
}

function sortTodos(a, b) {
  if (a.completed !== b.completed) {
    return Number(a.completed) - Number(b.completed);
  }

  const aOverdue = isOverdue(a);
  const bOverdue = isOverdue(b);
  if (aOverdue !== bOverdue) {
    return aOverdue ? -1 : 1;
  }

  const priorityRank = { high: 0, medium: 1, low: 2 };
  if (priorityRank[a.priority] !== priorityRank[b.priority]) {
    return priorityRank[a.priority] - priorityRank[b.priority];
  }

  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
    return a.dueDate.localeCompare(b.dueDate);
  }
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;

  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

// ==========================================================================
// 13. RENDERING ENGINE
// ==========================================================================
function render() {
  const openTodos = state.todos.filter((t) => !t.completed);
  const completedTodos = state.todos.filter((t) => t.completed);

  const todayTasks = state.todos.filter((t) => isToday(t) && !t.completed);
  const overdueTasks = state.todos.filter((t) => isOverdue(t) && !t.completed);
  const inboxTasks = state.todos.filter((t) => !t.project && !t.completed);
  const upcomingTasks = state.todos.filter((t) => isUpcoming(t) && !t.completed);

  // Update Header Date & Dynamic Greeting
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
    heroSubtitle.textContent = `Focused workspace for ${proj ? proj.name : "this project"}.`;
  } else if (state.currentView.startsWith("tag:")) {
    const tagName = state.currentView.slice(4);
    heroSubtitle.textContent = `All tasks tagged with #${tagName}.`;
  } else if (state.currentView.startsWith("calendar:")) {
    const calDate = state.currentView.slice(9);
    heroSubtitle.textContent = `Tasks scheduled for ${formatDueDate(calDate)}.`;
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

  // Update Section Header & Subheader
  updateViewHeaders();

  // Render Task List
  const visibleTodos = getVisibleTodos();
  summaryText.textContent = buildSummary(visibleTodos.length, openTodos.length);

  todoList.innerHTML = "";

  if (visibleTodos.length === 0) {
    todoList.append(buildEmptyStateElement());
  } else {
    visibleTodos.sort(sortTodos).forEach((todo) => {
      todoList.append(buildTodoElement(todo));
    });
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
      (t) => t.project === proj.id && !t.completed
    ).length;

    // Sidebar project button
    const li = document.createElement("li");
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

    li.append(button);
    projectsNavList.append(li);

    // Dropdown options
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
    todo.tags.forEach((tag) => {
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

  // 1. Animated Circular Checkbox
  const toggle = document.createElement("input");
  toggle.className = "todo-toggle";
  toggle.type = "checkbox";
  toggle.checked = todo.completed || isCompleting;
  toggle.setAttribute("aria-label", `Mark "${todo.title}" as ${todo.completed ? "incomplete" : "complete"}`);
  toggle.addEventListener("change", () => toggleTodo(todo.id));

  // 2. Content Container (Left Scan Path)
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

  // Editorial Dot-Separated Secondary Metadata Row
  const meta = document.createElement("div");
  meta.className = "todo-meta";
  const metaSegments = [];

  // Project segment
  if (todo.project) {
    const proj = state.projects.find((p) => p.id === todo.project);
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

  // Subtasks counter segment
  if (todo.subtasks && todo.subtasks.length > 0) {
    const doneSubtasks = todo.subtasks.filter((s) => s.completed).length;
    const subtaskSpan = document.createElement("span");
    subtaskSpan.className = "todo-meta-item";
    subtaskSpan.textContent = `${doneSubtasks}/${todo.subtasks.length} subtasks`;
    metaSegments.push(subtaskSpan);
  }

  // Assemble segments with subtle dot separators
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

  // 3. Actions & Priority Badges (Right Scan Path)
  const actions = document.createElement("div");
  actions.className = "todo-actions";

  // Priority Badge
  actions.append(buildBadge("priority", capitalize(todo.priority), `priority-${todo.priority}`));

  const editButton = document.createElement("button");
  editButton.className = "icon-btn";
  editButton.type = "button";
  editButton.title = "Edit task";
  editButton.setAttribute("aria-label", `Edit "${todo.title}"`);
  editButton.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
    </svg>
  `;
  editButton.addEventListener("click", () => editTodo(todo.id));

  const deleteButton = document.createElement("button");
  deleteButton.className = "icon-btn";
  deleteButton.type = "button";
  deleteButton.title = "Delete task";
  deleteButton.setAttribute("aria-label", `Delete "${todo.title}"`);
  deleteButton.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>
  `;
  deleteButton.addEventListener("click", () => deleteTodo(todo.id));

  actions.append(editButton, deleteButton);
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
// 14. SECONDARY DESKTOP RAIL RENDERER (Contextual & Functional)
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
  const firstDayIndex = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7; // Monday = 0

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

  // 3. Up Next Deadlines (Dynamic Priority & Date Sorting)
  let upcomingTasks = state.todos
    .filter((t) => !t.completed && t.dueDate && t.dueDate > getLocalDateString());

  // If in project view, filter up next to that project
  if (state.currentView.startsWith("project:")) {
    const projId = state.currentView.slice(8);
    upcomingTasks = upcomingTasks.filter((t) => t.project === projId);
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
        if (task.dueDate) {
          setView(`calendar:${task.dueDate}`);
        } else {
          setView("upcoming");
        }
      });
      upNextList.append(li);
    });
  }

  // 4. Projects Snapshot (Dynamic Velocity Progress)
  projectsSnapshotList.innerHTML = "";
  state.projects.slice(0, 4).forEach((proj) => {
    const totalProj = state.todos.filter((t) => t.project === proj.id).length;
    const doneProj = state.todos.filter((t) => t.project === proj.id && t.completed).length;
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
// 15. CRUD ACTIONS & SATISFYING COMPLETION ANIMATION
// ==========================================================================
function toggleTodo(id) {
  const todo = state.todos.find((t) => t.id === id);
  if (!todo) return;

  const willBeDone = !todo.completed;

  if (willBeDone) {
    // 1. Satisfying completion sequence:
    // Mark as completing immediately to trigger checkmark animation & title strike
    state.completingTodoIds.add(id);

    const itemEl = document.querySelector(`.todo-item[data-id="${id}"]`);
    if (itemEl) {
      itemEl.classList.add("completing");
      const chk = itemEl.querySelector(".todo-toggle");
      if (chk) chk.checked = true;
    }

    // 2. Delay removal/re-sorting by 320ms so user enjoys the completion feedback
    setTimeout(() => {
      state.completingTodoIds.delete(id);
      state.todos = state.todos.map((t) => {
        if (t.id === id) {
          return {
            ...t,
            completed: true,
            completedAt: new Date().toISOString()
          };
        }
        return t;
      });
      DataStore.saveTodos(state.todos);
      render();
      showToast("Task completed 🎉", 2000);
    }, 320);
  } else {
    state.todos = state.todos.map((t) => {
      if (t.id === id) {
        return {
          ...t,
          completed: false,
          completedAt: ""
        };
      }
      return t;
    });
    DataStore.saveTodos(state.todos);
    render();
    showToast("Task marked incomplete", 1800);
  }
}

function deleteTodo(id) {
  state.todos = state.todos.filter((todo) => todo.id !== id);
  DataStore.saveTodos(state.todos);
  render();
  showToast("Task deleted", 2000);
}

function editTodo(id) {
  const todo = state.todos.find((entry) => entry.id === id);
  if (!todo) return;

  const nextTitle = window.prompt("Update task title:", todo.title);
  if (nextTitle === null) return;

  const trimmed = nextTitle.trim();
  if (!trimmed) {
    window.alert("Task title cannot be empty.");
    return;
  }

  state.todos = state.todos.map((entry) =>
    entry.id === id ? { ...entry, title: trimmed } : entry
  );

  DataStore.saveTodos(state.todos);
  render();
  showToast("Task title updated", 2000);
}

function clearCompleted() {
  const completedCount = state.todos.filter((t) => t.completed).length;
  if (completedCount === 0) {
    showToast("No completed tasks to clear.", 2000);
    return;
  }

  if (window.confirm(`Clear ${completedCount} completed task${completedCount === 1 ? "" : "s"}?`)) {
    state.todos = state.todos.filter((todo) => !todo.completed);
    DataStore.saveTodos(state.todos);
    render();
    showToast(`Cleared ${completedCount} completed task${completedCount === 1 ? "" : "s"}.`, 2500);
  }
}

function setView(viewName) {
  state.currentView = viewName;

  // Preset Project
  if (viewName.startsWith("project:")) {
    const projId = viewName.slice(8);
    projectInput.value = projId;
    mobileProjectInput.value = projId;
  } else {
    projectInput.value = "";
    mobileProjectInput.value = "";
  }

  // Preset Date
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
// 16. EVENT LISTENERS
// ==========================================================================

// Desktop Task Creation
todoForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const title = todoInput.value.trim();
  if (!title) return;

  const priority = priorityInput.value;
  const dueDate = dueDateInput.value;
  const dueTime = dueTimeInput.value;
  const project = projectInput.value;
  const rawTags = tagsInput.value;

  const tags = rawTags
    .split(",")
    .map((t) => t.trim().replace(/^#/, "").toLowerCase())
    .filter((t) => t.length > 0);

  const newTodo = createTodo(title, priority, dueDate, dueTime, project, tags);
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
  const project = mobileProjectInput.value;
  const rawTags = mobileTagsInput.value;

  const tags = rawTags
    .split(",")
    .map((t) => t.trim().replace(/^#/, "").toLowerCase())
    .filter((t) => t.length > 0);

  const newTodo = createTodo(title, priority, dueDate, dueTime, project, tags);
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

// Add Project Button
if (addProjectBtn) {
  addProjectBtn.addEventListener("click", () => {
    const name = window.prompt("Enter new project name:");
    if (!name || !name.trim()) return;

    const trimmed = name.trim();
    const id = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    if (state.projects.some((p) => p.id === id)) {
      window.alert("A project with this name already exists.");
      return;
    }

    const colors = ["#f08352", "#4e9d75", "#d7a34b", "#a569bd", "#3498db", "#e74c3c"];
    const randomColor = colors[state.projects.length % colors.length];

    state.projects.push({ id, name: trimmed, color: randomColor });
    DataStore.saveProjects(state.projects);
    render();
    showToast(`Project "${trimmed}" created`, 2200);
  });
}

// Keyboard Shortcuts & Global Esc Handler
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeMobileSidebar();
    closeMobileBottomSheet();
    if (userProfileWrap) {
      userProfileWrap.classList.remove("open");
    }
  }
});

// ==========================================================================
// 17. LIGHTWEIGHT NATIVE WEBGL ATMOSPHERIC SHADER ENGINE
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
// 18. INITIALIZATION
// ==========================================================================
applyTheme(state.theme);
setupComposerInteractions();
setupStatCards();
setupUserProfileMenu();

if (state.currentView === "today") {
  dueDateInput.value = getLocalDateString();
  mobileDueDateInput.value = getLocalDateString();
}

render();

// Initialize Ambient WebGL Canvas
const ambientCanvas = new AmbientCanvas("ambientCanvas");
