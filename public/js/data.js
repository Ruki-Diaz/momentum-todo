/**
 * Momentum — Constants, data normalization, recurrence, and storage (local + cloud).
 * Classic script: shares global scope with the other files in /js, loaded in order by index.html.
 */

// ==========================================================================
// 1. CONSTANTS & DEFAULT DATA
// ==========================================================================
const STORAGE_KEY = "momentum-todos-v1";
const STORAGE_PROJECTS_KEY = "momentum-projects-v1";
const STORAGE_THEME_KEY = "momentum-theme";
const STORAGE_SORT_KEY = "momentum-sort";

const DEFAULT_PROJECTS = [];

const PROJECT_COLORS = [
  "#f08352", "#4e9d75", "#d7a34b", "#a569bd", "#3498db", "#e74c3c"
];

// ==========================================================================
// 1B. HTML ESCAPING — use for every user/AI-provided value placed in innerHTML
// ==========================================================================
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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
// 4. STORAGE REPOSITORY ARCHITECTURE (Local Mode & Authenticated Cloud Mode)
// ==========================================================================

// 4A. Local Data Store (localStorage backed)
const LocalDataStore = {
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

// Legacy fallback alias
const DataStore = LocalDataStore;

// 4B. Authenticated Cloud API Client
const ApiClient = {
  async request(path, options = {}) {
    const session = AuthManager.clerk?.session;
    if (!session) {
      const err = new Error("No active authenticated session.");
      err.status = 401;
      err.code = "UNAUTHORIZED";
      throw err;
    }

    let token = await session.getToken();
    if (!token) {
      const err = new Error("Could not retrieve session token.");
      err.status = 401;
      err.code = "UNAUTHORIZED";
      throw err;
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    };

    const fetchOptions = {
      ...options,
      headers
    };

    if (fetchOptions.body && typeof fetchOptions.body === "object") {
      fetchOptions.body = JSON.stringify(fetchOptions.body);
    }

    let res = await fetch(`/api${path}`, fetchOptions);

    // If 401, attempt one fresh token retry
    if (res.status === 401 && !options._retried) {
      try {
        token = await session.getToken({ skipCache: true });
        if (token) {
          headers.Authorization = `Bearer ${token}`;
          res = await fetch(`/api${path}`, { ...fetchOptions, headers, _retried: true });
        }
      } catch (refreshErr) {
        console.warn("[ApiClient] Token refresh attempt failed:", refreshErr);
      }
    }

    let resJson = null;
    const contentType = res.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      resJson = await res.json().catch(() => null);
    }

    if (!res.ok) {
      const errorObj = resJson?.error || {
        code: res.status === 409 ? "STALE_VERSION" : "API_ERROR",
        message: `Request failed with status ${res.status}`
      };
      const error = new Error(errorObj.message || "An unexpected API error occurred.");
      error.status = res.status;
      error.code = errorObj.code;
      error.details = errorObj.details;
      throw error;
    }

    return resJson;
  }
};

// 4C. Cloud Data Store (REST API backed)
const CloudDataStore = {
  saveQueues: new Map(),

  async listProjects() {
    const res = await ApiClient.request("/projects", { method: "GET" });
    return (res.data || []).map(normalizeProject).filter(Boolean);
  },

  async createProject(data) {
    const res = await ApiClient.request("/projects", {
      method: "POST",
      body: { name: data.name, color: data.color }
    });
    return normalizeProject(res.data);
  },

  async updateProject(id, data, version) {
    const res = await ApiClient.request(`/projects/${id}`, {
      method: "PATCH",
      body: { name: data.name, color: data.color, version: version || 1 }
    });
    return normalizeProject(res.data);
  },

  async deleteProject(id, version) {
    await ApiClient.request(`/projects/${id}`, {
      method: "DELETE",
      body: { version: version || 1 }
    });
    return true;
  },

  async listTasks() {
    const res = await ApiClient.request("/tasks", { method: "GET" });
    return (res.data || []).map((t) => normalizeTodo(t, state.projects)).filter(Boolean);
  },

  async getTask(id) {
    const res = await ApiClient.request(`/tasks/${id}`, { method: "GET" });
    return normalizeTodo(res.data, state.projects);
  },

  async createTask(data) {
    const payload = {
      title: data.title,
      description: data.description || "",
      priority: data.priority || "medium",
      dueDate: data.dueDate || null,
      dueTime: data.dueTime || null,
      projectId: data.projectId || null,
      tags: data.tags || [],
      notes: data.notes || "",
      reminder: data.reminder || null,
      recurrence: data.recurrence || "none",
      subtasks: (data.subtasks || []).map((s) => ({ title: s.title, completed: s.completed }))
    };
    const res = await ApiClient.request("/tasks", {
      method: "POST",
      body: payload
    });
    return normalizeTodo(res.data, state.projects);
  },

  async updateTask(id, data, version) {
    const res = await ApiClient.request(`/tasks/${id}`, {
      method: "PATCH",
      body: { ...data, version: version || 1 }
    });
    return normalizeTodo(res.data, state.projects);
  },

  async deleteTask(id, version) {
    await ApiClient.request(`/tasks/${id}`, {
      method: "DELETE",
      body: { version: version || 1 }
    });
    return true;
  },

  async completeTask(id, version) {
    const res = await ApiClient.request(`/tasks/${id}/complete`, {
      method: "POST",
      body: { version: version || 1 }
    });
    return {
      task: normalizeTodo(res.data.task, state.projects),
      nextOccurrence: res.data.nextOccurrence
        ? normalizeTodo(res.data.nextOccurrence, state.projects)
        : null
    };
  },

  async createSubtask(taskId, data) {
    const res = await ApiClient.request(`/tasks/${taskId}/subtasks`, {
      method: "POST",
      body: { title: data.title, completed: data.completed ?? false }
    });
    return res.data;
  },

  async updateSubtask(taskId, subtaskId, data, version) {
    const res = await ApiClient.request(`/tasks/${taskId}/subtasks/${subtaskId}`, {
      method: "PATCH",
      body: { ...data, version: version || 1 }
    });
    return res.data;
  },

  async deleteSubtask(taskId, subtaskId, version) {
    await ApiClient.request(`/tasks/${taskId}/subtasks/${subtaskId}`, {
      method: "DELETE",
      body: { version: version || 1 }
    });
    return true;
  },

  async getSettings() {
    const res = await ApiClient.request("/settings", { method: "GET" });
    return res.data;
  },

  async updateSettings(data, version) {
    const res = await ApiClient.request("/settings", {
      method: "PATCH",
      body: { ...data, version: version || 1 }
    });
    return res.data;
  },

  async importWorkspace(importId, snapshot) {
    const res = await ApiClient.request("/workspace/import", {
      method: "POST",
      body: {
        importId,
        projects: snapshot.projects || [],
        tasks: snapshot.tasks || [],
        settings: snapshot.settings || {}
      }
    });
    return res.data;
  },

  // Serialized Task Save Execution (Coalesces edits & avoids 409 collisions)
  queueTaskSave(taskId, updatedFields, onStatusChange) {
    let queue = this.saveQueues.get(taskId);
    if (!queue) {
      queue = { inFlight: false, pendingData: null };
      this.saveQueues.set(taskId, queue);
    }

    queue.pendingData = { ...(queue.pendingData || {}), ...updatedFields };
    if (onStatusChange) onStatusChange("saving");

    if (queue.inFlight) return;

    this.processTaskSaveQueue(taskId, onStatusChange);
  },

  async processTaskSaveQueue(taskId, onStatusChange) {
    const queue = this.saveQueues.get(taskId);
    if (!queue || !queue.pendingData) {
      if (onStatusChange) onStatusChange("saved");
      return;
    }

    const todo = state.todos.find((t) => t.id === taskId);
    if (!todo) {
      queue.pendingData = null;
      if (onStatusChange) onStatusChange("saved");
      return;
    }

    const payload = queue.pendingData;
    queue.pendingData = null;
    queue.inFlight = true;

    try {
      const updated = await this.updateTask(taskId, payload, todo.version || 1);
      state.todos = state.todos.map((t) => (t.id === taskId ? { ...t, ...updated } : t));
      render();
    } catch (err) {
      console.warn("[CloudDataStore] Task autosave failed:", err);
      if (err.code === "STALE_VERSION" || err.status === 409) {
        showToast("This item changed on another device.", 3500);
        try {
          const fresh = await this.getTask(taskId);
          state.todos = state.todos.map((t) => (t.id === taskId ? fresh : t));
          if (state.activeDrawerTodoId === taskId) {
            populateDrawerInputs(fresh);
          }
          render();
        } catch (fetchErr) {
          console.error("Failed to reconcile stale cloud task:", fetchErr);
        }
      } else {
        showToast(err.message || "Failed to save changes to cloud.", 3000);
      }
    } finally {
      queue.inFlight = false;
      if (queue.pendingData) {
        this.processTaskSaveQueue(taskId, onStatusChange);
      } else {
        if (onStatusChange) onStatusChange("saved");
      }
    }
  },

  // Serialized Settings Save Execution (Rapid theme/sort changes coalesce version-safely)
  settingsSaveQueue: {
    inFlight: false,
    pendingData: null
  },

  queueSettingsSave(settingsFields) {
    this.settingsSaveQueue.pendingData = {
      ...(this.settingsSaveQueue.pendingData || {}),
      ...settingsFields
    };

    if (this.settingsSaveQueue.inFlight) return;
    this.processSettingsSaveQueue();
  },

  async processSettingsSaveQueue() {
    if (!this.settingsSaveQueue.pendingData) return;

    const payload = this.settingsSaveQueue.pendingData;
    this.settingsSaveQueue.pendingData = null;
    this.settingsSaveQueue.inFlight = true;

    try {
      const updated = await this.updateSettings(payload, state.cloudSettingsVersion || 1);
      state.cloudSettingsVersion = updated.version || ((state.cloudSettingsVersion || 1) + 1);
    } catch (err) {
      console.warn("[CloudDataStore] Settings save failed:", err);
      if (err.code === "STALE_VERSION" || err.status === 409) {
        try {
          const fresh = await this.getSettings();
          state.cloudSettingsVersion = fresh.version;
        } catch (fetchErr) {
          console.error("Failed to reconcile settings version:", fetchErr);
        }
      }
    } finally {
      this.settingsSaveQueue.inFlight = false;
      if (this.settingsSaveQueue.pendingData) {
        this.processSettingsSaveQueue();
      }
    }
  }
};

// 4D. Workspace Repository Facade
const WorkspaceRepository = {
  workspaceGeneration: 0,

  getMode() {
    return state.workspaceMode;
  },

  isCloud() {
    return state.workspaceMode === "cloud";
  },

  async init() {
    state.workspaceMode = "local";
    state.cloudStatus = "idle";
    state.cloudError = null;
    state.projects = LocalDataStore.getProjects();
    state.todos = LocalDataStore.getTodos(state.projects);
    state.theme = LocalDataStore.getTheme();
    state.sort = LocalDataStore.getSortPreference();
    render();
  },

  async switchToCloud(user) {
    this.workspaceGeneration++;
    const currentGen = this.workspaceGeneration;

    state.workspaceMode = "cloud";
    state.cloudStatus = "loading";
    state.cloudError = null;
    render();

    try {
      // 1. Fetch Cloud Settings
      let settings = null;
      try {
        settings = await CloudDataStore.getSettings();
      } catch (settingsErr) {
        console.warn("[WorkspaceRepository] Cloud settings fetch error:", settingsErr);
      }

      if (this.workspaceGeneration !== currentGen) return;

      if (settings) {
        state.cloudSettingsVersion = settings.version || 1;
        if (settings.theme && (settings.theme === "dark" || settings.theme === "light")) {
          applyTheme(settings.theme, false);
        }
        if (settings.sortPreference) {
          state.sort = settings.sortPreference;
          if (sortSelect) sortSelect.value = state.sort;
        }
      }

      // 2. Fetch Projects and Tasks
      const [cloudProjects, cloudTasks] = await Promise.all([
        CloudDataStore.listProjects(),
        CloudDataStore.listTasks()
      ]);

      if (this.workspaceGeneration !== currentGen) return;

      state.projects = cloudProjects;
      state.todos = cloudTasks;
      state.cloudStatus = "connected";
      state.cloudError = null;
      render();
    } catch (err) {
      if (this.workspaceGeneration !== currentGen) return;
      console.error("[WorkspaceRepository] Failed to load cloud workspace:", err);
      state.cloudStatus = "error";
      state.cloudError = err.message || "Unable to load cloud workspace.";
      render();
    }
  },

  async switchToLocal() {
    this.workspaceGeneration++;
    state.workspaceMode = "local";
    state.cloudStatus = "idle";
    state.cloudError = null;

    // Restore local data
    state.projects = LocalDataStore.getProjects();
    state.todos = LocalDataStore.getTodos(state.projects);
    state.theme = LocalDataStore.getTheme();
    state.sort = LocalDataStore.getSortPreference();

    applyTheme(state.theme, false);
    if (sortSelect) sortSelect.value = state.sort;

    render();
  },

  async createTask(taskData) {
    if (this.isCloud()) {
      const created = await CloudDataStore.createTask(taskData);
      state.todos = [created, ...state.todos];
      render();
      return created;
    } else {
      const newTodo = {
        id: crypto.randomUUID(),
        title: taskData.title,
        description: taskData.description || "",
        priority: taskData.priority || "medium",
        dueDate: taskData.dueDate || null,
        dueTime: taskData.dueTime || null,
        projectId: taskData.projectId || null,
        tags: taskData.tags || [],
        completed: false,
        createdAt: new Date().toISOString(),
        completedAt: null,
        subtasks: (taskData.subtasks || []).map((s) => ({
          id: crypto.randomUUID(),
          title: s.title,
          completed: s.completed ?? false,
          createdAt: new Date().toISOString()
        })),
        notes: taskData.notes || "",
        reminder: taskData.reminder || null,
        recurrence: taskData.recurrence || "none",
        recurrenceSeriesId: null,
        generatedNextOccurrenceId: null
      };
      state.todos = [newTodo, ...state.todos];
      LocalDataStore.saveTodos(state.todos);
      render();
      return newTodo;
    }
  },

  async updateTask(taskId, updatedFields, onStatusChange) {
    if (this.isCloud()) {
      CloudDataStore.queueTaskSave(taskId, updatedFields, onStatusChange);
    } else {
      state.todos = state.todos.map((t) => (t.id === taskId ? { ...t, ...updatedFields } : t));
      LocalDataStore.saveTodos(state.todos);
      if (onStatusChange) onStatusChange("saved");
      render();
    }
  },

  async deleteTask(taskId) {
    const todo = state.todos.find((t) => t.id === taskId);
    if (!todo) return;

    if (this.isCloud()) {
      await CloudDataStore.deleteTask(taskId, todo.version || 1);
      state.todos = state.todos.filter((t) => t.id !== taskId);
      render();
    } else {
      state.todos = state.todos.filter((t) => t.id !== taskId);
      LocalDataStore.saveTodos(state.todos);
      render();
    }
  },

  async createProject(projectData) {
    if (this.isCloud()) {
      const created = await CloudDataStore.createProject(projectData);
      state.projects.push(created);
      render();
      return created;
    } else {
      const newProj = {
        id: crypto.randomUUID(),
        name: projectData.name,
        color: projectData.color || PROJECT_COLORS[0],
        createdAt: new Date().toISOString()
      };
      state.projects.push(newProj);
      LocalDataStore.saveProjects(state.projects);
      render();
      return newProj;
    }
  },

  async updateProject(id, projectData) {
    const proj = state.projects.find((p) => p.id === id);
    if (this.isCloud()) {
      const updated = await CloudDataStore.updateProject(id, projectData, proj?.version || 1);
      state.projects = state.projects.map((p) => (p.id === id ? updated : p));
      render();
      return updated;
    } else {
      state.projects = state.projects.map((p) => (p.id === id ? { ...p, ...projectData } : p));
      LocalDataStore.saveProjects(state.projects);
      render();
    }
  },

  async deleteProject(projectId) {
    const proj = state.projects.find((p) => p.id === projectId);
    if (this.isCloud()) {
      await CloudDataStore.deleteProject(projectId, proj?.version || 1);
      state.projects = state.projects.filter((p) => p.id !== projectId);
      state.todos = state.todos.map((t) =>
        t.projectId === projectId ? { ...t, projectId: null } : t
      );
      render();
    } else {
      LocalDataStore.deleteProject(projectId);
      render();
    }
  },

  async createSubtask(taskId, subtaskData) {
    const todo = state.todos.find((t) => t.id === taskId);
    if (!todo) return;

    if (this.isCloud()) {
      const created = await CloudDataStore.createSubtask(taskId, subtaskData);
      todo.subtasks = [...(todo.subtasks || []), created];
      render();
      return created;
    } else {
      const newSt = {
        id: crypto.randomUUID(),
        title: subtaskData.title,
        completed: subtaskData.completed ?? false,
        createdAt: new Date().toISOString()
      };
      todo.subtasks = [...(todo.subtasks || []), newSt];
      LocalDataStore.saveTodos(state.todos);
      render();
      return newSt;
    }
  },

  async updateSubtask(taskId, subtaskId, data) {
    const todo = state.todos.find((t) => t.id === taskId);
    if (!todo) return;
    const st = (todo.subtasks || []).find((s) => s.id === subtaskId);

    if (this.isCloud()) {
      const updated = await CloudDataStore.updateSubtask(taskId, subtaskId, data, st?.version || 1);
      todo.subtasks = (todo.subtasks || []).map((s) => (s.id === subtaskId ? updated : s));
      render();
      return updated;
    } else {
      todo.subtasks = (todo.subtasks || []).map((s) => (s.id === subtaskId ? { ...s, ...data } : s));
      LocalDataStore.saveTodos(state.todos);
      render();
    }
  },

  async deleteSubtask(taskId, subtaskId) {
    const todo = state.todos.find((t) => t.id === taskId);
    if (!todo) return;
    const st = (todo.subtasks || []).find((s) => s.id === subtaskId);

    if (this.isCloud()) {
      await CloudDataStore.deleteSubtask(taskId, subtaskId, st?.version || 1);
      todo.subtasks = (todo.subtasks || []).filter((s) => s.id !== subtaskId);
      render();
    } else {
      todo.subtasks = (todo.subtasks || []).filter((s) => s.id !== subtaskId);
      LocalDataStore.saveTodos(state.todos);
      render();
    }
  },

  async updateTheme(theme) {
    if (this.isCloud()) {
      CloudDataStore.queueSettingsSave({ theme });
    } else {
      LocalDataStore.saveTheme(theme);
    }
  },

  async updateSortPreference(sort) {
    if (this.isCloud()) {
      CloudDataStore.queueSettingsSave({ sortPreference: sort });
    } else {
      LocalDataStore.saveSortPreference(sort);
    }
  }
};
