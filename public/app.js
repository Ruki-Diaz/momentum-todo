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

const DEFAULT_PROJECTS = [];

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

function populateDrawerInputs(todo) {
  if (!todo) return;

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

  if (drawerSaveStatus) {
    drawerSaveStatus.textContent = "Saved ✓";
    drawerSaveStatus.classList.remove("saving");
  }
}

// ==========================================================================
// 14. TASK DETAILS DRAWER (Autosave, Subtasks, Tags, Meta)
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
  const dueDate = drawerDueDateInput.value || null;
  const dueTime = drawerDueTimeInput.value || null;
  const recurrence = drawerRecurrenceInput.value || "none";
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
    const changedFields = {
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

    WorkspaceRepository.updateTask(todoId, changedFields, (status) => {
      if (drawerSaveStatus) {
        if (status === "saving") {
          drawerSaveStatus.textContent = "Saving…";
          drawerSaveStatus.classList.add("saving");
        } else {
          drawerSaveStatus.textContent = "Saved ✓";
          drawerSaveStatus.classList.remove("saving");
        }
      }
    });
  } else {
    if (drawerSaveStatus) {
      drawerSaveStatus.textContent = "Saved ✓";
      drawerSaveStatus.classList.remove("saving");
    }
  }
}

function openTaskDetails(todoId) {
  flushDrawerAutosave();

  const todo = state.todos.find((t) => t.id === todoId);
  if (!todo) return;

  state.lastFocusedElement = document.activeElement;
  state.activeDrawerTodoId = todoId;

  populateDrawerInputs(todo);

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
    chip.querySelector(".drawer-tag-remove").addEventListener("click", async () => {
      const nextTags = (todo.tags || []).filter((t) => t !== tag);
      todo.tags = nextTags;
      await WorkspaceRepository.updateTask(todo.id, { tags: nextTags });
      renderDrawerTags(todo);
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
    chk.addEventListener("change", async () => {
      st.completed = chk.checked;
      await WorkspaceRepository.updateSubtask(todo.id, st.id, { completed: chk.checked });
      renderDrawerSubtasks(todo);
    });

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "subtask-title-input";
    titleInput.value = st.title;
    titleInput.addEventListener("blur", async () => {
      const newTitle = titleInput.value.trim() || st.title;
      if (newTitle !== st.title) {
        st.title = newTitle;
        await WorkspaceRepository.updateSubtask(todo.id, st.id, { title: newTitle });
      }
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn icon-btn-tiny subtask-delete-btn";
    delBtn.setAttribute("aria-label", `Delete subtask "${st.title}"`);
    delBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    `;
    delBtn.addEventListener("click", async () => {
      await WorkspaceRepository.deleteSubtask(todo.id, st.id);
      const fresh = state.todos.find((t) => t.id === todo.id);
      if (fresh) renderDrawerSubtasks(fresh);
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

  drawerTagsInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const raw = drawerTagsInput.value.trim();
      if (!raw || !state.activeDrawerTodoId) return;

      const todoId = state.activeDrawerTodoId;
      const todo = state.todos.find((t) => t.id === todoId);
      if (!todo) return;

      const norm = normalizeTag(raw);
      if (norm && !(todo.tags || []).includes(norm)) {
        const nextTags = [...(todo.tags || []), norm];
        todo.tags = nextTags;
        await WorkspaceRepository.updateTask(todoId, { tags: nextTags });
        renderDrawerTags(todo);
      }
      drawerTagsInput.value = "";
    }
  });

  drawerAddSubtaskForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = newSubtaskInput.value.trim();
    if (!title || !state.activeDrawerTodoId) return;

    const todoId = state.activeDrawerTodoId;
    const todo = state.todos.find((t) => t.id === todoId);
    if (!todo) return;

    newSubtaskInput.value = "";
    await WorkspaceRepository.createSubtask(todoId, { title, completed: false });
    const fresh = state.todos.find((t) => t.id === todoId);
    if (fresh) renderDrawerSubtasks(fresh);
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

  projectModalForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = projectNameInput.value.trim();
    if (!name) return;

    const selectedSwatch = projectColorPalette.querySelector(".color-swatch-btn.selected");
    const color = selectedSwatch ? selectedSwatch.dataset.color : PROJECT_COLORS[0];
    const editId = projectModalEditId.value;

    if (editId) {
      await WorkspaceRepository.updateProject(editId, { name, color });
      showToast(`Project "${name}" updated`, 2200);
    } else {
      await WorkspaceRepository.createProject({ name, color });
      showToast(`Project "${name}" created`, 2200);
    }

    closeProjectModal();
  });

  deleteProjectBtn.addEventListener("click", async () => {
    const editId = projectModalEditId.value;
    if (!editId) return;

    const proj = state.projects.find((p) => p.id === editId);
    if (!proj) return;

    const assignedCount = state.todos.filter((t) => t.projectId === editId).length;
    const confirmMsg = assignedCount > 0
      ? `Delete project "${proj.name}"? Its ${assignedCount} task${assignedCount === 1 ? "" : "s"} will move to Inbox.`
      : `Delete project "${proj.name}"?`;

    if (window.confirm(confirmMsg)) {
      await WorkspaceRepository.deleteProject(editId);
      closeProjectModal();
      if (state.currentView === `project:${editId}`) {
        setView("inbox");
      }
      showToast(`Project "${proj.name}" deleted.`, 2800, () => {
        if (!WorkspaceRepository.isCloud()) {
          state.undoManager.undo();
        }
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
  inboxBtn.addEventListener("click", async () => {
    await moveTodoToProject(todoId, null);
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
    projBtn.addEventListener("click", async () => {
      await moveTodoToProject(todoId, proj.id);
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

async function moveTodoToProject(todoId, nextProjectId) {
  const todo = state.todos.find((t) => t.id === todoId);
  if (!todo) return;

  await WorkspaceRepository.updateTask(todoId, { projectId: nextProjectId });
  const proj = state.projects.find((p) => p.id === nextProjectId);
  showToast(proj ? `Moved to ${proj.name}` : "Moved to Inbox", 2000);
}

async function handleDuplicateTodo(todoId) {
  const original = state.todos.find((t) => t.id === todoId);
  if (!original) return;

  const cloneData = {
    title: `${original.title} (Copy)`,
    description: original.description || "",
    priority: original.priority || "medium",
    dueDate: original.dueDate || null,
    dueTime: original.dueTime || null,
    projectId: original.projectId || null,
    tags: [...(original.tags || [])],
    notes: original.notes || "",
    reminder: original.reminder || null,
    recurrence: "none",
    subtasks: (original.subtasks || []).map((s) => ({
      title: s.title,
      completed: false
    }))
  };

  await WorkspaceRepository.createTask(cloneData);
  showToast(`Duplicated "${original.title}"`, 2200);
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

  if (menuEditProfileBtn) {
    menuEditProfileBtn.addEventListener("click", () => {
      userProfileWrap.classList.remove("open");
      userProfileBtn.setAttribute("aria-expanded", "false");
      AuthManager.openProfileEditor();
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

  const menuAccountDataBtn = document.querySelector("#menuAccountDataBtn");
  if (menuAccountDataBtn) {
    menuAccountDataBtn.addEventListener("click", () => {
      userProfileWrap.classList.remove("open");
      userProfileBtn.setAttribute("aria-expanded", "false");
      AccountDataManager.open();
    });
  }

  const menuPrivacyBtn = document.querySelector("#menuPrivacyBtn");
  if (menuPrivacyBtn) {
    menuPrivacyBtn.addEventListener("click", () => {
      userProfileWrap.classList.remove("open");
      userProfileBtn.setAttribute("aria-expanded", "false");
      PrivacyManager.open();
    });
  }

  const menuFeedbackBtn = document.querySelector("#menuFeedbackBtn");
  if (menuFeedbackBtn) {
    menuFeedbackBtn.addEventListener("click", () => {
      userProfileWrap.classList.remove("open");
      userProfileBtn.setAttribute("aria-expanded", "false");
      FeedbackManager.open();
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

  showLanding() {
    const appShellEl = document.getElementById("appShell");
    if (appShellEl) {
      appShellEl.classList.remove("app-shell-visible");
      appShellEl.hidden = true;
    }
    if (typeof LandingPage !== "undefined") {
      LandingPage.show();
    }
  },

  showAppShell() {
    if (typeof LandingPage !== "undefined") {
      LandingPage.hide();
    }
    const appShellEl = document.getElementById("appShell");
    if (appShellEl) {
      appShellEl.classList.add("app-shell-visible");
      appShellEl.hidden = false;
    }
  },

  async init() {
    this.setupListeners();

    // Register LandingPage CTA handlers
    if (typeof LandingPage !== "undefined") {
      LandingPage.registerCTAHandlers({
        onGetStarted: () => this.openSignIn(),
        onSignIn: () => this.openSignIn(),
        onContinueLocal: () => {
          localStorage.setItem("momentum-workspace-intent", "local");
          this.showAppShell();
          this.setSignedOutState();
          WorkspaceRepository.switchToLocal();
        }
      });
    }

    try {
      // 1. Fetch Clerk Publishable Key safely from backend config endpoint
      const configRes = await fetch("/api/auth/config");
      if (!configRes.ok) {
        throw new Error(`Failed to load auth config: ${configRes.status}`);
      }
      const config = await configRes.json();
      this.publishableKey = config.publishableKey;

      if (!this.publishableKey) {
        console.warn("Clerk publishable key not configured; evaluating workspace intent.");
        const intent = localStorage.getItem("momentum-workspace-intent");
        if (intent === "local") {
          this.showAppShell();
          this.setSignedOutState();
          await WorkspaceRepository.switchToLocal();
        } else {
          this.setSignedOutState();
          this.showLanding();
        }
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
          this.showAppShell();
          await this.syncUserWithBackend(session);
        } else {
          const intent = localStorage.getItem("momentum-workspace-intent");
          if (intent === "local") {
            this.showAppShell();
            this.setSignedOutState();
            await WorkspaceRepository.switchToLocal();
          } else {
            this.setSignedOutState();
            this.showLanding();
          }
        }
      });

      // 5. Initial auth evaluation
      if (this.clerk.user && this.clerk.session) {
        this.showAppShell();
        await this.syncUserWithBackend(this.clerk.session);
      } else {
        const intent = localStorage.getItem("momentum-workspace-intent");
        if (intent === "local") {
          this.showAppShell();
          this.setSignedOutState();
          await WorkspaceRepository.switchToLocal();
        } else {
          this.setSignedOutState();
          this.showLanding();
        }
      }
    } catch (err) {
      console.warn("Auth initialization fallback:", err);
      this.status = "signed_out";
      const intent = localStorage.getItem("momentum-workspace-intent");
      if (intent === "local") {
        this.showAppShell();
        this.setSignedOutState();
        await WorkspaceRepository.switchToLocal();
      } else {
        this.setSignedOutState();
        this.showLanding();
      }
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

      // 1. Try initiating Sign-In with email code
      let signInSuccess = false;
      try {
        const signIn = await this.clerk.client.signIn.create({
          identifier: email
        });

        // Check for direct email_code factor in supportedFirstFactors
        const emailCodeFactor = signIn.supportedFirstFactors?.find(
          (f) => f.strategy === "email_code"
        );

        if (emailCodeFactor && emailCodeFactor.emailAddressId) {
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
        // User is new or sign-in not applicable; proceeding to sign-up flow
      }

      if (signInSuccess) return;

      // 2. User is new or needs Sign-Up -> Initiate Sign-Up
      let signUp = null;
      try {
        signUp = await this.clerk.client.signUp.create({
          emailAddress: email,
          password: tempSecret
        });
      } catch (signUpWithPwErr) {
        signUp = await this.clerk.client.signUp.create({
          emailAddress: email
        });
      }

      await signUp.prepareEmailAddressVerification({
        strategy: "email_code"
      });

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

      if (this.flowState.mode === "sign_in_email_code") {
        const result = await this.clerk.client.signIn.attemptFirstFactor({
          strategy: "email_code",
          code: code
        });

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

        if (result.status === "complete") {
          createdSessionId = result.createdSessionId;
        } else {
          throw new Error(`Sign in status: ${result.status}`);
        }
      } else if (this.flowState.mode === "sign_up") {
        let result = await this.clerk.client.signUp.attemptEmailAddressVerification({
          code: code
        });

        if (result.status === "complete") {
          createdSessionId = result.createdSessionId;
        } else if (result.status === "missing_requirements") {
          const missing = result.missingFields || [];
          const unverified = result.unverifiedFields || [];
          const allMissing = Array.from(new Set([...missing, ...unverified]));
          console.warn("[Momentum Auth] SignUp missing requirements:", allMissing);

          if (allMissing.includes("password")) {
            const updated = await this.clerk.client.signUp.update({
              password: this.flowState.tempSecret || `M0m!_${crypto.randomUUID()}#9Z`
            });

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

      // Check & persist client-detected IANA timezone dynamically
      try {
        const clientTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        if (user.settings && user.settings.timezone !== clientTz) {
          CloudDataStore.updateSettings({ timezone: clientTz }).catch((e) => console.warn("Timezone sync warning:", e));
        }
      } catch (tzErr) {
        console.warn("Timezone detection failed:", tzErr);
      }

      // Check if user needs display name onboarding or 3-step first-time onboarding
      const hasDisplayName = Boolean(user.displayName && user.displayName.trim());
      if (!hasDisplayName) {
        this.openDisplayNameModal(user);
      } else if (user.settings && !user.settings.onboardingCompleted) {
        OnboardingManager.open();
      } else {
        showToast(`Welcome back, ${user.displayName || "Explorer"}!`, 3000);
      }

      // Switch to Cloud Workspace
      await WorkspaceRepository.switchToCloud(user);
      render();
    } catch (err) {
      console.error("Backend identity verification failed:", err);
      this.status = "signed_out";
      const intent = localStorage.getItem("momentum-workspace-intent");
      if (intent === "local") {
        this.showAppShell();
        this.setSignedOutState();
        await WorkspaceRepository.switchToLocal();
      } else {
        this.setSignedOutState();
        this.showLanding();
      }
      showToast("Authentication sync failed. Running in Local Mode.", 3500);
    }
  },

  // --------------------------------------------------------------------------
  // Display Name Onboarding Modal
  // --------------------------------------------------------------------------
  openDisplayNameModal(user) {
    const overlay = document.getElementById("displayNameModalOverlay");
    const input = document.getElementById("dnModalInput");
    const error = document.getElementById("dnModalError");
    if (error) {
      error.textContent = "";
      error.style.display = "none";
    }
    if (input) {
      input.value = "";
    }
    if (overlay) {
      overlay.classList.add("active");
      overlay.setAttribute("aria-hidden", "false");
      setTimeout(() => input?.focus(), 50);
    }
  },

  closeDisplayNameModal() {
    const overlay = document.getElementById("displayNameModalOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
  },

  async handleDisplayNameSubmit() {
    const input = document.getElementById("dnModalInput");
    const error = document.getElementById("dnModalError");
    const spinner = document.getElementById("dnModalSpinner");
    const btnText = document.querySelector("#dnModalSubmitBtn .dn-modal-btn-text");
    const btn = document.getElementById("dnModalSubmitBtn");

    const rawName = (input?.value || "").trim();
    if (!rawName) {
      if (error) {
        error.textContent = "Please enter a name.";
        error.style.display = "block";
      }
      return;
    }
    if (rawName.length > 50) {
      if (error) {
        error.textContent = "Display name cannot exceed 50 characters.";
        error.style.display = "block";
      }
      return;
    }

    if (btn) btn.disabled = true;
    if (btnText) btnText.style.display = "none";
    if (spinner) spinner.style.display = "inline-block";
    if (error) error.style.display = "none";

    try {
      const session = this.clerk?.session;
      const token = session ? await session.getToken() : null;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ displayName: rawName })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || "Failed to update display name.");
      }

      const { user: updatedUser } = await res.json();
      this.currentUser = updatedUser;
      this.setSignedInState(updatedUser);
      this.closeDisplayNameModal();
      render();

      if (updatedUser.settings && !updatedUser.settings.onboardingCompleted) {
        OnboardingManager.open();
      } else {
        showToast(`Welcome to Momentum, ${updatedUser.displayName}!`, 3000);
      }
    } catch (err) {
      console.error("Display name update error:", err);
      if (error) {
        error.textContent = err.message || "Failed to save display name. Please try again.";
        error.style.display = "block";
      }
    } finally {
      if (btn) btn.disabled = false;
      if (btnText) btnText.style.display = "inline";
      if (spinner) spinner.style.display = "none";
    }
  },

  // --------------------------------------------------------------------------
  // Profile Editor Modal
  // --------------------------------------------------------------------------
  openProfileEditor() {
    if (!this.currentUser) return;
    const overlay = document.getElementById("profileEditorOverlay");
    const nameInput = document.getElementById("profileEditorNameInput");
    const emailInput = document.getElementById("profileEditorEmailDisplay");
    const error = document.getElementById("profileEditorError");

    if (error) {
      error.textContent = "";
      error.style.display = "none";
    }
    if (nameInput) {
      nameInput.value = this.currentUser.displayName || "";
    }
    if (emailInput) {
      emailInput.value = this.currentUser.email || "";
    }
    if (overlay) {
      overlay.classList.add("active");
      overlay.setAttribute("aria-hidden", "false");
      setTimeout(() => nameInput?.focus(), 50);
    }
  },

  closeProfileEditor() {
    const overlay = document.getElementById("profileEditorOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
  },

  async handleProfileSave() {
    const nameInput = document.getElementById("profileEditorNameInput");
    const error = document.getElementById("profileEditorError");
    const spinner = document.getElementById("profileEditorSpinner");
    const btnText = document.querySelector("#profileEditorSaveBtn .profile-editor-btn-text");
    const btn = document.getElementById("profileEditorSaveBtn");

    const rawName = (nameInput?.value || "").trim();
    if (!rawName) {
      if (error) {
        error.textContent = "Display name cannot be empty.";
        error.style.display = "block";
      }
      return;
    }
    if (rawName.length > 50) {
      if (error) {
        error.textContent = "Display name cannot exceed 50 characters.";
        error.style.display = "block";
      }
      return;
    }

    if (btn) btn.disabled = true;
    if (btnText) btnText.style.display = "none";
    if (spinner) spinner.style.display = "inline-block";
    if (error) error.style.display = "none";

    try {
      const session = this.clerk?.session;
      const token = session ? await session.getToken() : null;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ displayName: rawName })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || "Failed to update profile.");
      }

      const { user: updatedUser } = await res.json();
      this.currentUser = updatedUser;
      this.setSignedInState(updatedUser);
      this.closeProfileEditor();
      render();
      showToast("Profile updated successfully.", 3000);
    } catch (err) {
      console.error("Profile save error:", err);
      if (error) {
        error.textContent = err.message || "Failed to save profile. Please try again.";
        error.style.display = "block";
      }
    } finally {
      if (btn) btn.disabled = false;
      if (btnText) btnText.style.display = "inline";
      if (spinner) spinner.style.display = "none";
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

    localStorage.removeItem("momentum-workspace-intent");
    this.currentUser = null;
    this.status = "signed_out";
    this.setSignedOutState();
    this.showLanding();
    showToast("Signed out.", 2500);
  },

  setSignedInState(user) {
    const avatarEl = document.querySelector("#userProfileBtn .user-avatar");
    const nameEl = document.querySelector("#userProfileBtn .user-name");
    const statusEl = document.querySelector("#userProfileBtn .user-status");

    // Identity hierarchy: verified display/full name → first name → "Momentum User"
    const displayName = (user.displayName && user.displayName.trim()) || user.firstName || "Momentum User";
    const avatarInitial = displayName !== "Momentum User" ? (displayName[0] || "M").toUpperCase() : "M";

    if (avatarEl) {
      if (user.avatarUrl) {
        const img = document.createElement("img");
        img.src = user.avatarUrl;
        img.className = "user-avatar-img";
        img.alt = "Profile photo";
        avatarEl.textContent = "";
        avatarEl.appendChild(img);
      } else {
        avatarEl.textContent = avatarInitial;
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
    if (accountMenuHeaderSub) accountMenuHeaderSub.textContent = user.email || "Cloud Account";

    if (menuSignInBtn) menuSignInBtn.style.display = "none";
    if (menuEditProfileBtn) menuEditProfileBtn.style.display = "flex";
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
      avatarEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"></path></svg>`;
    }

    if (nameEl) {
      nameEl.textContent = "Local Workspace";
    }

    if (statusEl) {
      statusEl.className = "user-status";
      statusEl.textContent = "Local Mode";
    }

    if (accountMenuHeaderTitle) accountMenuHeaderTitle.textContent = "Local Workspace";
    if (accountMenuHeaderSub) accountMenuHeaderSub.textContent = "Offline-Ready";

    if (menuSignInBtn) menuSignInBtn.style.display = "flex";
    if (menuEditProfileBtn) menuEditProfileBtn.style.display = "none";
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

    // Display Name Onboarding Modal elements
    const dnModalSubmitBtn = document.getElementById("dnModalSubmitBtn");
    const dnModalInput = document.getElementById("dnModalInput");
    const displayNameModalOverlay = document.getElementById("displayNameModalOverlay");

    // Profile Editor Modal elements
    const profileEditorCloseBtn = document.getElementById("profileEditorCloseBtn");
    const profileEditorCancelBtn = document.getElementById("profileEditorCancelBtn");
    const profileEditorSaveBtn = document.getElementById("profileEditorSaveBtn");
    const profileEditorOverlay = document.getElementById("profileEditorOverlay");
    const profileEditorNameInput = document.getElementById("profileEditorNameInput");

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
      continueLocalBtn.addEventListener("click", () => {
        this.closeSignInModal();
        localStorage.setItem("momentum-workspace-intent", "local");
        this.showAppShell();
        this.setSignedOutState();
        WorkspaceRepository.switchToLocal();
      });
    }

    if (resendCodeBtn) {
      resendCodeBtn.addEventListener("click", () => this.handleResendCode());
    }

    if (changeEmailBtn) {
      changeEmailBtn.addEventListener("click", () => this.setStep(1));
    }

    // Display Name Onboarding Modal listeners
    if (dnModalSubmitBtn) {
      dnModalSubmitBtn.addEventListener("click", () => this.handleDisplayNameSubmit());
    }

    if (dnModalInput) {
      dnModalInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.handleDisplayNameSubmit();
        }
      });
    }

    // Profile Editor Modal listeners
    if (profileEditorCloseBtn) {
      profileEditorCloseBtn.addEventListener("click", () => this.closeProfileEditor());
    }

    if (profileEditorCancelBtn) {
      profileEditorCancelBtn.addEventListener("click", () => this.closeProfileEditor());
    }

    if (profileEditorSaveBtn) {
      profileEditorSaveBtn.addEventListener("click", () => this.handleProfileSave());
    }

    if (profileEditorNameInput) {
      profileEditorNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.handleProfileSave();
        }
      });
    }

    if (profileEditorOverlay) {
      profileEditorOverlay.addEventListener("click", (e) => {
        if (e.target === profileEditorOverlay) {
          this.closeProfileEditor();
        }
      });
    }

    // Global modal Escape handler
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (profileEditorOverlay && profileEditorOverlay.classList.contains("active")) {
          this.closeProfileEditor();
        }
        if (document.getElementById("onboardingModalOverlay")?.classList.contains("active")) {
          OnboardingManager.close();
        }
        if (document.getElementById("accountDataModalOverlay")?.classList.contains("active")) {
          AccountDataManager.close();
        }
        if (document.getElementById("deleteAccountModalOverlay")?.classList.contains("active")) {
          AccountDataManager.closeDeleteModal();
        }
        if (document.getElementById("privacyModalOverlay")?.classList.contains("active")) {
          PrivacyManager.close();
        }
        if (document.getElementById("feedbackModalOverlay")?.classList.contains("active")) {
          FeedbackManager.close();
        }
      }
    });
  }
};

// ==========================================================================
// 17C. STAGE 5: ONBOARDING MANAGER (3-STEP WORKFLOW)
// ==========================================================================
const OnboardingManager = {
  currentStep: 1,

  open() {
    const overlay = document.getElementById("onboardingModalOverlay");
    if (!overlay) return;
    this.setStep(1);
    overlay.classList.add("active");
    overlay.setAttribute("aria-hidden", "false");
  },

  close() {
    const overlay = document.getElementById("onboardingModalOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
  },

  setStep(stepNum) {
    this.currentStep = stepNum;
    for (let i = 1; i <= 3; i++) {
      const stepEl = document.getElementById(`onboardingStep${i}`);
      const indEl = document.getElementById(`onboardingStepIndicator${i}`);
      if (stepEl) stepEl.style.display = i === stepNum ? "block" : "none";
      if (indEl) {
        if (i <= stepNum) {
          indEl.classList.add("active");
        } else {
          indEl.classList.remove("active");
        }
      }
    }
    if (stepNum === 3) {
      setTimeout(() => document.getElementById("onboardingFirstTaskInput")?.focus(), 50);
    }
  },

  async skip() {
    try {
      if (WorkspaceRepository.isCloud()) {
        await CloudDataStore.updateSettings({ onboardingCompleted: true });
        if (AuthManager.currentUser && AuthManager.currentUser.settings) {
          AuthManager.currentUser.settings.onboardingCompleted = true;
        }
      }
    } catch (err) {
      console.warn("Skip onboarding error:", err);
    }
    this.close();
  },

  async finish() {
    const spinner = document.getElementById("onboardingSpinner");
    const finishBtn = document.getElementById("onboardingStep3FinishBtn");
    const btnText = finishBtn?.querySelector(".btn-text");
    if (finishBtn) finishBtn.disabled = true;
    if (btnText) btnText.style.display = "none";
    if (spinner) spinner.style.display = "inline-block";

    try {
      // Create starter projects if selected
      const workSelected = document.getElementById("onboardProjWork")?.checked;
      const personalSelected = document.getElementById("onboardProjPersonal")?.checked;
      const sideProjSelected = document.getElementById("onboardProjSideProjects")?.checked;

      let createdWorkProj = null;

      if (workSelected) {
        createdWorkProj = await WorkspaceRepository.createProject({
          name: "Work & Professional",
          color: "#f08352"
        });
      }
      if (personalSelected) {
        await WorkspaceRepository.createProject({
          name: "Personal Life",
          color: "#4e9d75"
        });
      }
      if (sideProjSelected) {
        await WorkspaceRepository.createProject({
          name: "Creative & Ideas",
          color: "#7c6bf0"
        });
      }

      // Create first task if typed
      const firstTaskTitle = (document.getElementById("onboardingFirstTaskInput")?.value || "").trim();
      if (firstTaskTitle) {
        const todayStr = getLocalDateString();
        await WorkspaceRepository.createTask({
          title: firstTaskTitle,
          description: "",
          priority: "high",
          dueDate: todayStr,
          dueTime: null,
          projectId: createdWorkProj ? createdWorkProj.id : null,
          tags: ["focus"],
          notes: "",
          reminder: null,
          recurrence: "none",
          subtasks: []
        });
      }

      // Persist onboardingCompleted
      if (WorkspaceRepository.isCloud()) {
        await CloudDataStore.updateSettings({ onboardingCompleted: true });
        if (AuthManager.currentUser && AuthManager.currentUser.settings) {
          AuthManager.currentUser.settings.onboardingCompleted = true;
        }
      }

      this.close();
      render();
      showToast("Workspace initialized. Welcome to Momentum!", 3500);
    } catch (err) {
      console.error("Finish onboarding error:", err);
      showToast("Setup encountered an issue, but your workspace is ready.", 3000);
      this.close();
    } finally {
      if (finishBtn) finishBtn.disabled = false;
      if (btnText) btnText.style.display = "inline";
      if (spinner) spinner.style.display = "none";
    }
  },

  setupListeners() {
    document.getElementById("onboardingStep1NextBtn")?.addEventListener("click", () => this.setStep(2));
    document.getElementById("onboardingStep1SkipBtn")?.addEventListener("click", () => this.skip());
    document.getElementById("onboardingStep2BackBtn")?.addEventListener("click", () => this.setStep(1));
    document.getElementById("onboardingStep2NextBtn")?.addEventListener("click", () => this.setStep(3));
    document.getElementById("onboardingStep3SkipBtn")?.addEventListener("click", () => this.skip());
    document.getElementById("onboardingStep3FinishBtn")?.addEventListener("click", () => this.finish());
    document.getElementById("onboardingFirstTaskInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.finish();
      }
    });
  }
};

// ==========================================================================
// 17D. STAGE 5: ACCOUNT & DATA MANAGEMENT & FAILURE-SAFE DELETION
// ==========================================================================
const AccountDataManager = {
  open() {
    const overlay = document.getElementById("accountDataModalOverlay");
    const statusText = document.getElementById("accountDataStatusText");
    const dangerZone = document.getElementById("accountDataDangerZone");
    if (!overlay) return;

    if (userProfileWrap) userProfileWrap.classList.remove("open");
    if (userProfileBtn) userProfileBtn.setAttribute("aria-expanded", "false");

    const isCloud = WorkspaceRepository.isCloud() && AuthManager.currentUser;
    if (statusText) {
      statusText.textContent = isCloud
        ? `Signed in as ${AuthManager.currentUser.displayName || "Momentum User"} (${AuthManager.currentUser.email || "Cloud Account"}). Cloud sync active.`
        : "Using Local Workspace (on-device localStorage). No cloud account attached.";
    }

    if (dangerZone) {
      dangerZone.style.display = isCloud ? "block" : "none";
    }

    overlay.classList.add("active");
    overlay.setAttribute("aria-hidden", "false");
  },

  close() {
    const overlay = document.getElementById("accountDataModalOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
  },

  exportCloud() {
    if (!WorkspaceRepository.isCloud() || !AuthManager.currentUser) {
      showToast("Please sign in to export cloud workspace.", 3000);
      return;
    }
    const backup = {
      app: "Momentum",
      scope: "cloud",
      user: AuthManager.currentUser.email || AuthManager.currentUser.id,
      exportedAt: new Date().toISOString(),
      todos: state.todos,
      projects: state.projects
    };
    this.downloadJson(backup, `momentum-cloud-backup-${getLocalDateString()}.json`);
    showToast("Cloud workspace exported successfully (JSON).", 2500);
  },

  exportLocal() {
    const localTodos = LocalDataStore.getTodos();
    const localProjects = LocalDataStore.getProjects();
    const backup = {
      app: "Momentum",
      scope: "local",
      exportedAt: new Date().toISOString(),
      todos: localTodos,
      projects: localProjects
    };
    this.downloadJson(backup, `momentum-local-backup-${getLocalDateString()}.json`);
    showToast("Local workspace exported successfully (JSON).", 2500);
  },

  downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  openDeleteModal() {
    this.close();
    const overlay = document.getElementById("deleteAccountModalOverlay");
    const input = document.getElementById("deleteConfirmInput");
    const btn = document.getElementById("confirmDeleteAccountBtn");
    const err = document.getElementById("deleteAccountError");
    if (input) input.value = "";
    if (btn) btn.disabled = true;
    if (err) {
      err.textContent = "";
      err.style.display = "none";
    }
    if (overlay) {
      overlay.classList.add("active");
      overlay.setAttribute("aria-hidden", "false");
      setTimeout(() => input?.focus(), 50);
    }
  },

  closeDeleteModal() {
    const overlay = document.getElementById("deleteAccountModalOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
  },

  async handleDeleteAccount() {
    const input = document.getElementById("deleteConfirmInput");
    const btn = document.getElementById("confirmDeleteAccountBtn");
    const btnText = btn?.querySelector(".btn-text");
    const spinner = btn?.querySelector(".delete-spinner");
    const errEl = document.getElementById("deleteAccountError");

    if ((input?.value || "").trim() !== "DELETE") {
      return;
    }

    if (btn) btn.disabled = true;
    if (btnText) btnText.style.display = "none";
    if (spinner) spinner.style.display = "inline-block";
    if (errEl) errEl.style.display = "none";

    try {
      const session = AuthManager.clerk?.session;
      const token = session ? await session.getToken() : null;
      if (!token) throw new Error("Authentication token unavailable.");

      const res = await fetch("/api/auth/me", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Account deletion failed with status ${res.status}`);
      }

      const resJson = await res.json().catch(() => ({}));

      if (resJson.status === "PARTIAL_DELETION") {
        // Cloud data in Neon was deleted; Clerk identity deletion did not complete
        this.closeDeleteModal();
        await AuthManager.signOut();
        showToast("Cloud workspace data was permanently deleted. Authentication identity cleanup requires manual action.", 6000);
        return;
      }

      // Full deletion completed (both Neon database and Clerk identity wiped)
      // Note: Local storage (Local Workspace) is strictly preserved!
      this.closeDeleteModal();
      await AuthManager.signOut();
      showToast("Your Momentum Cloud account has been permanently deleted.", 4500);
    } catch (err) {
      console.error("Account deletion failed:", err);
      if (errEl) {
        errEl.textContent = err.message || "Failed to delete account. Please try again.";
        errEl.style.display = "block";
      }
      if (btn) btn.disabled = false;
      if (btnText) btnText.style.display = "inline";
      if (spinner) spinner.style.display = "none";
    }
  },

  setupListeners() {
    document.getElementById("closeAccountDataModalBtn")?.addEventListener("click", () => this.close());
    document.getElementById("exportCloudDataBtn")?.addEventListener("click", () => this.exportCloud());
    document.getElementById("exportLocalDataBtn")?.addEventListener("click", () => this.exportLocal());
    document.getElementById("openDeleteAccountModalBtn")?.addEventListener("click", () => this.openDeleteModal());
    document.getElementById("closeDeleteAccountModalBtn")?.addEventListener("click", () => this.closeDeleteModal());
    document.getElementById("cancelDeleteAccountBtn")?.addEventListener("click", () => this.closeDeleteModal());
    
    const confirmInput = document.getElementById("deleteConfirmInput");
    const confirmBtn = document.getElementById("confirmDeleteAccountBtn");
    if (confirmInput && confirmBtn) {
      confirmInput.addEventListener("input", (e) => {
        confirmBtn.disabled = e.target.value.trim() !== "DELETE";
      });
    }

    confirmBtn?.addEventListener("click", () => this.handleDeleteAccount());
  }
};

// ==========================================================================
// 17E. STAGE 5: PRIVACY & DATA TRANSPARENCY MODAL
// ==========================================================================
const PrivacyManager = {
  open() {
    const overlay = document.getElementById("privacyModalOverlay");
    if (userProfileWrap) userProfileWrap.classList.remove("open");
    if (userProfileBtn) userProfileBtn.setAttribute("aria-expanded", "false");
    if (overlay) {
      overlay.classList.add("active");
      overlay.setAttribute("aria-hidden", "false");
    }
  },

  close() {
    const overlay = document.getElementById("privacyModalOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
  },

  setupListeners() {
    document.getElementById("landingPrivacyBtn")?.addEventListener("click", () => this.open());
    document.getElementById("menuPrivacyBtn")?.addEventListener("click", () => this.open());
    document.getElementById("closePrivacyModalBtn")?.addEventListener("click", () => this.close());
    document.getElementById("closePrivacyModalBottomBtn")?.addEventListener("click", () => this.close());
    const overlay = document.getElementById("privacyModalOverlay");
    if (overlay) {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) this.close();
      });
    }
  }
};

// ==========================================================================
// 17F. STAGE 5: FEEDBACK MODAL
// ==========================================================================
const FeedbackManager = {
  open() {
    const overlay = document.getElementById("feedbackModalOverlay");
    if (userProfileWrap) userProfileWrap.classList.remove("open");
    if (userProfileBtn) userProfileBtn.setAttribute("aria-expanded", "false");
    if (overlay) {
      overlay.classList.add("active");
      overlay.setAttribute("aria-hidden", "false");
    }
  },

  close() {
    const overlay = document.getElementById("feedbackModalOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
  },

  setupListeners() {
    document.getElementById("landingFeedbackBtn")?.addEventListener("click", () => this.open());
    document.getElementById("menuFeedbackBtn")?.addEventListener("click", () => this.open());
    document.getElementById("closeFeedbackModalBtn")?.addEventListener("click", () => this.close());
    document.getElementById("closeFeedbackNoticeBtn")?.addEventListener("click", () => this.close());
    const overlay = document.getElementById("feedbackModalOverlay");
    if (overlay) {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) this.close();
      });
    }
  }
};

// ==========================================================================
// 17B. STAGE 4E: IMPORT WORKSPACE MANAGER
// ==========================================================================
const ImportManager = {
  isImporting: false,

  checkAndPromptImport() {
    const banner = document.getElementById("importWorkspaceBanner");
    const menuBtn = document.getElementById("menuImportWorkspaceBtn");

    // Only available when connected in Cloud mode
    if (!WorkspaceRepository.isCloud() || state.cloudStatus !== "connected") {
      if (banner) banner.style.display = "none";
      if (menuBtn) menuBtn.style.display = "none";
      return;
    }

    const localTodos = LocalDataStore.getTodos();
    const localProjects = LocalDataStore.getProjects();
    const totalLocalItems = localTodos.length + localProjects.length;

    // No local data -> hide banner & menu button
    if (totalLocalItems === 0) {
      if (banner) banner.style.display = "none";
      if (menuBtn) menuBtn.style.display = "none";
      return;
    }

    // Has local data -> show menu button for explicit invocation
    if (menuBtn) menuBtn.style.display = "flex";

    // Check banner suppression (session dismissal or previously recorded import)
    const userId = AuthManager.currentUser?.id;
    const isSessionDismissed = userId && sessionStorage.getItem(`momentum_import_dismissed_${userId}`) === "true";

    let isAlreadyImported = false;
    try {
      const history = JSON.parse(localStorage.getItem("momentum_import_history_v1") || "{}");
      if (userId && history[userId]) {
        isAlreadyImported = true;
      }
    } catch {
      isAlreadyImported = false;
    }

    if (!isSessionDismissed && !isAlreadyImported) {
      if (banner) {
        banner.style.display = "flex";
        const taskCountEl = document.getElementById("importBannerTaskCount");
        const projCountEl = document.getElementById("importBannerProjectCount");
        if (taskCountEl) taskCountEl.textContent = localTodos.length;
        if (projCountEl) projCountEl.textContent = localProjects.length;
      }
    } else {
      if (banner) banner.style.display = "none";
    }
  },

  dismissBanner() {
    const banner = document.getElementById("importWorkspaceBanner");
    if (banner) banner.style.display = "none";
    const userId = AuthManager.currentUser?.id;
    if (userId) {
      sessionStorage.setItem(`momentum_import_dismissed_${userId}`, "true");
    }
  },

  openImportModal() {
    if (userProfileWrap) userProfileWrap.classList.remove("open");
    if (userProfileBtn) userProfileBtn.setAttribute("aria-expanded", "false");

    const localTodos = LocalDataStore.getTodos();
    const localProjects = LocalDataStore.getProjects();
    const localSubtasks = localTodos.reduce((sum, t) => sum + (Array.isArray(t.subtasks) ? t.subtasks.length : 0), 0);

    const taskCountEl = document.getElementById("importModalTaskCount");
    const projCountEl = document.getElementById("importModalProjectCount");
    const subtaskCountEl = document.getElementById("importModalSubtaskCount");
    const errorEl = document.getElementById("importModalError");
    const confirmBtn = document.getElementById("importModalConfirmBtn");
    const spinner = confirmBtn?.querySelector(".import-btn-spinner");

    if (taskCountEl) taskCountEl.textContent = localTodos.length;
    if (projCountEl) projCountEl.textContent = localProjects.length;
    if (subtaskCountEl) subtaskCountEl.textContent = localSubtasks;

    if (errorEl) {
      errorEl.style.display = "none";
      errorEl.textContent = "";
    }

    if (confirmBtn) {
      confirmBtn.disabled = false;
      const btnText = confirmBtn.querySelector(".btn-text");
      if (btnText) btnText.textContent = "Import Workspace";
    }
    if (spinner) spinner.style.display = "none";

    const modalOverlay = document.getElementById("importModalOverlay");
    if (modalOverlay) {
      modalOverlay.classList.add("active");
      modalOverlay.setAttribute("aria-hidden", "false");
    }
  },

  closeImportModal() {
    const modalOverlay = document.getElementById("importModalOverlay");
    if (modalOverlay) {
      modalOverlay.classList.remove("active");
      modalOverlay.setAttribute("aria-hidden", "true");
    }
  },

  async handleImport() {
    if (this.isImporting) return;

    const confirmBtn = document.getElementById("importModalConfirmBtn");
    const spinner = confirmBtn?.querySelector(".import-btn-spinner");
    const errorEl = document.getElementById("importModalError");

    if (errorEl) {
      errorEl.style.display = "none";
      errorEl.textContent = "";
    }

    this.isImporting = true;
    if (confirmBtn) confirmBtn.disabled = true;
    if (spinner) spinner.style.display = "inline-block";

    try {
      const localProjects = LocalDataStore.getProjects();
      const localTodos = LocalDataStore.getTodos();
      const localTheme = LocalDataStore.getTheme();
      const localSort = LocalDataStore.getSortPreference();

      // Build payload matching server schema
      const snapshot = {
        projects: localProjects.map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          createdAt: p.createdAt || new Date().toISOString()
        })),
        tasks: localTodos.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description || "",
          priority: t.priority || "medium",
          dueDate: t.dueDate || null,
          dueTime: t.dueTime || null,
          projectId: t.projectId || null,
          tags: t.tags || [],
          completed: !!t.completed,
          createdAt: t.createdAt || new Date().toISOString(),
          completedAt: t.completedAt || null,
          subtasks: (t.subtasks || []).map((s) => ({
            id: s.id,
            title: s.title,
            completed: !!s.completed,
            createdAt: s.createdAt || new Date().toISOString()
          })),
          notes: t.notes || "",
          reminder: t.reminder || null,
          recurrence: t.recurrence || "none",
          recurrenceSeriesId: t.recurrenceSeriesId || null,
          generatedNextOccurrenceId: t.generatedNextOccurrenceId || null
        })),
        settings: {
          theme: localTheme,
          sortPreference: localSort
        }
      };

      const importId = crypto.randomUUID();
      const result = await CloudDataStore.importWorkspace(importId, snapshot);

      // Record non-sensitive minimal import metadata in local UX history
      const userId = AuthManager.currentUser?.id;
      if (userId) {
        try {
          const history = JSON.parse(localStorage.getItem("momentum_import_history_v1") || "{}");
          history[userId] = {
            importId,
            importedAt: new Date().toISOString(),
            taskCount: result.taskCount || 0,
            projectCount: result.projectCount || 0
          };
          localStorage.setItem("momentum_import_history_v1", JSON.stringify(history));
        } catch (storageErr) {
          console.warn("[ImportManager] Failed to write import history:", storageErr);
        }
      }

      this.closeImportModal();

      const banner = document.getElementById("importWorkspaceBanner");
      if (banner) banner.style.display = "none";

      const addedTasks = result.taskCount || 0;
      const addedProjects = result.projectCount || 0;
      showToast(`Import complete! Added ${addedTasks} task${addedTasks === 1 ? "" : "s"} and ${addedProjects} project${addedProjects === 1 ? "" : "s"}.`, 4000);

      // Authoritative Cloud Refresh
      await WorkspaceRepository.switchToCloud(AuthManager.currentUser);
    } catch (err) {
      console.error("[ImportManager] Workspace import failed:", err);
      if (errorEl) {
        errorEl.textContent = err.message || "An error occurred while importing the workspace. Please try again.";
        errorEl.style.display = "block";
      }
      if (confirmBtn) confirmBtn.disabled = false;
      if (spinner) spinner.style.display = "none";
    } finally {
      this.isImporting = false;
    }
  },

  setupListeners() {
    const bannerDismissBtn = document.getElementById("importBannerDismissBtn");
    const bannerActionBtn = document.getElementById("importBannerActionBtn");
    const menuImportBtn = document.getElementById("menuImportWorkspaceBtn");
    const closeImportModalBtn = document.getElementById("closeImportModalBtn");
    const cancelImportModalBtn = document.getElementById("importModalCancelBtn");
    const confirmImportModalBtn = document.getElementById("importModalConfirmBtn");
    const importModalOverlay = document.getElementById("importModalOverlay");

    if (bannerDismissBtn) {
      bannerDismissBtn.addEventListener("click", () => this.dismissBanner());
    }

    if (bannerActionBtn) {
      bannerActionBtn.addEventListener("click", () => this.openImportModal());
    }

    if (menuImportBtn) {
      menuImportBtn.addEventListener("click", () => this.openImportModal());
    }

    if (closeImportModalBtn) {
      closeImportModalBtn.addEventListener("click", () => this.closeImportModal());
    }

    if (cancelImportModalBtn) {
      cancelImportModalBtn.addEventListener("click", () => {
        this.closeImportModal();
        this.dismissBanner();
      });
    }

    if (confirmImportModalBtn) {
      confirmImportModalBtn.addEventListener("click", () => this.handleImport());
    }

    if (importModalOverlay) {
      importModalOverlay.addEventListener("click", (e) => {
        if (e.target === importModalOverlay && !this.isImporting) {
          this.closeImportModal();
        }
      });
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
    const authUser = typeof AuthManager !== "undefined" ? AuthManager.currentUser : null;
    // Extract first name: prefer first word of authoritative displayName, otherwise firstName
    let firstName = "";
    if (authUser) {
      if (authUser.displayName && authUser.displayName.trim()) {
        firstName = authUser.displayName.trim().split(/\s+/)[0];
      } else if (authUser.firstName && authUser.firstName.trim()) {
        firstName = authUser.firstName.trim();
      }
    }

    // Clear the span and rebuild using safe DOM methods (never innerHTML with user data)
    heroGreetingText.textContent = "";
    const greetingNode = document.createTextNode(
      firstName ? `${greeting}, ` : `${greeting}.`
    );
    heroGreetingText.appendChild(greetingNode);

    if (firstName) {
      const nameSpan = document.createElement("span");
      nameSpan.className = "hero-name-highlight";
      nameSpan.textContent = firstName;
      heroGreetingText.appendChild(nameSpan);
      heroGreetingText.appendChild(document.createTextNode("."));
    }
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

    if (state.workspaceMode === "cloud" && state.cloudStatus === "loading") {
      summaryText.textContent = "Syncing cloud workspace…";
      todoList.append(buildCloudLoadingElement());
    } else if (state.workspaceMode === "cloud" && state.cloudStatus === "error") {
      summaryText.textContent = "Cloud workspace unavailable";
      todoList.append(buildCloudErrorElement(state.cloudError, () => WorkspaceRepository.switchToCloud(AuthManager.currentUser)));
    } else if (sortedTodos.length === 0) {
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

  // Check and prompt workspace import if eligible
  ImportManager.checkAndPromptImport();
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

function buildCloudLoadingElement() {
  const container = document.createElement("div");
  container.className = "cloud-loading-container";
  container.innerHTML = `
    <div class="cloud-loading-spinner"></div>
    <div class="cloud-loading-text">Connecting to cloud workspace…</div>
  `;
  return container;
}

function buildCloudErrorElement(errorMessage, onRetry) {
  const container = document.createElement("div");
  container.className = "cloud-error-container";
  container.innerHTML = `
    <div class="cloud-error-icon">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
    </div>
    <h3 class="cloud-error-title">Unable to load cloud workspace</h3>
    <p class="cloud-error-desc">${errorMessage || "A temporary connection issue occurred while syncing with the server."}</p>
  `;
  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.className = "btn btn-primary cloud-retry-btn";
  retryBtn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10"></polyline>
      <polyline points="1 20 1 14 7 14"></polyline>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
    </svg>
    <span>Retry</span>
  `;
  retryBtn.addEventListener("click", onRetry);
  container.appendChild(retryBtn);
  return container;
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
async function toggleTodo(id) {
  const todo = state.todos.find((t) => t.id === id);
  if (!todo) return;

  // Prevent double click/submit while in flight
  if (state.completingTodoIds.has(id)) return;

  const willBeDone = !todo.completed;

  if (WorkspaceRepository.isCloud()) {
    state.completingTodoIds.add(id);

    const itemEl = document.querySelector(`.todo-item[data-id="${id}"]`);
    if (itemEl) {
      if (willBeDone) itemEl.classList.add("completing");
      const chk = itemEl.querySelector(".todo-toggle");
      if (chk) chk.checked = willBeDone;
    }

    try {
      if (willBeDone) {
        // Cloud authoritative completion
        const res = await CloudDataStore.completeTask(id, todo.version || 1);
        const { task: completedTask, nextOccurrence } = res;

        let updatedTodos = state.todos.map((t) => (t.id === id ? completedTask : t));
        if (nextOccurrence) {
          updatedTodos = [nextOccurrence, ...updatedTodos];
        }
        state.todos = updatedTodos;
        render();

        if (state.activeDrawerTodoId === id) {
          updateDrawerStatusButton(completedTask);
        }

        const toastMsg = nextOccurrence
          ? `Completed. Next occurrence scheduled for ${formatDueDate(nextOccurrence.dueDate)}`
          : "Task completed 🎉";
        showToast(toastMsg, 3000);
      } else {
        // Cloud uncomplete
        const updated = await CloudDataStore.updateTask(id, { completed: false, completedAt: null }, todo.version || 1);
        state.todos = state.todos.map((t) => (t.id === id ? updated : t));
        render();

        if (state.activeDrawerTodoId === id) {
          updateDrawerStatusButton(updated);
        }
        showToast("Task marked incomplete", 2500);
      }
    } catch (err) {
      console.error("[toggleTodo] Cloud toggle error:", err);
      showToast(err.message || "Failed to update task status in cloud.", 3500);
      render();
    } finally {
      state.completingTodoIds.delete(id);
    }
    return;
  }

  // Local Mode Implementation (preserved)
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
      LocalDataStore.saveTodos(state.todos);
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

    LocalDataStore.saveTodos(state.todos);
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

async function deleteTodo(id) {
  const index = state.todos.findIndex((t) => t.id === id);
  if (index === -1) return;

  const todo = state.todos[index];

  if (WorkspaceRepository.isCloud()) {
    try {
      await CloudDataStore.deleteTask(id, todo.version || 1);
      state.todos = state.todos.filter((t) => t.id !== id);
      render();
      showToast(`Deleted "${todo.title}"`, 3000);
    } catch (err) {
      console.error("[deleteTodo] Cloud delete error:", err);
      showToast(err.message || "Failed to delete task from cloud.", 3500);
      render();
    }
  } else {
    state.undoManager.push({
      type: "DELETE_TODO",
      todo: { ...todo },
      index
    });

    state.todos = state.todos.filter((t) => t.id !== id);
    LocalDataStore.saveTodos(state.todos);
    render();

    showToast(`Deleted "${todo.title}"`, 3500, () => {
      state.undoManager.undo();
    });
  }
}

async function clearCompleted() {
  const completedTodos = state.todos.filter((t) => t.completed);
  if (completedTodos.length === 0) {
    showToast("No completed tasks to clear.", 2000);
    return;
  }

  if (window.confirm(`Clear ${completedTodos.length} completed task${completedTodos.length === 1 ? "" : "s"}?`)) {
    if (WorkspaceRepository.isCloud()) {
      try {
        const results = await Promise.allSettled(
          completedTodos.map((t) => CloudDataStore.deleteTask(t.id, t.version || 1))
        );
        const successfulIds = new Set(
          completedTodos.filter((_, idx) => results[idx].status === "fulfilled").map((t) => t.id)
        );
        state.todos = state.todos.filter((t) => !successfulIds.has(t.id));
        render();
        showToast(`Cleared ${successfulIds.size} completed task${successfulIds.size === 1 ? "" : "s"}.`, 3500);
      } catch (err) {
        console.error("Failed to clear completed tasks in cloud:", err);
        showToast("Error clearing completed tasks.", 3500);
      }
    } else {
      state.undoManager.push({
        type: "CLEAR_COMPLETED",
        clearedTodos: [...completedTodos]
      });

      state.todos = state.todos.filter((todo) => !todo.completed);
      LocalDataStore.saveTodos(state.todos);
      render();

      showToast(`Cleared ${completedTodos.length} completed task${completedTodos.length === 1 ? "" : "s"}.`, 3500, () => {
        state.undoManager.undo();
      });
    }
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
    { title: "Plan My Day (AI)", meta: "AI", icon: "sparkles", action: () => MomentumAI.openPlanDay() },
    { title: "Morning Briefing (AI)", meta: "AI", icon: "sparkles", action: () => MomentumAI.openBriefing() },
    { title: "Weekly Review (AI)", meta: "AI", icon: "sparkles", action: () => MomentumAI.openWeeklyReview() },
    { title: "AI Project Planner", meta: "AI", icon: "sparkles", action: () => MomentumAI.openProjectPlanner() },
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

  // AI Natural Language Query Item
  const aiItems = [];
  if (needle && needle.length >= 2) {
    aiItems.push({
      title: `Ask Momentum Intelligence: "${query.trim()}"`,
      meta: "AI Action",
      icon: "sparkles",
      action: () => {
        closeCommandPalette();
        MomentumAI.handleCommandQuery(query.trim());
      }
    });
  }

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
  if (aiItems.length > 0) sections.push({ group: "Momentum Intelligence", items: aiItems });
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
      const reminderMsg = `⏰ Reminder: "${todo.title}" is due ${formatDueDate(todo.dueDate, todo.dueTime)}`;
      showToast(reminderMsg, 5000);

      // Active-tab browser notification if permission granted
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("Momentum Reminder", {
            body: reminderMsg,
            icon: "/favicon.svg"
          });
        } catch (nErr) {
          // ignore notification delivery error
        }
      }
    }
  });
}

// ==========================================================================
// 26. TASK CREATION FORM LISTENERS
// ==========================================================================
function setupTaskCreationListeners() {
  // Desktop Task Creation
  todoForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const title = todoInput.value.trim();
    if (!title) return;

    // Check for natural language AI prompt prefix (ai: or /ai)
    if (title.toLowerCase().startsWith("ai:") || title.toLowerCase().startsWith("/ai ") || title.toLowerCase().startsWith("!ai ")) {
      const prompt = title.replace(/^(ai:|\/ai|!ai)\s*/i, "").trim();
      todoInput.value = "";
      collapseComposer();
      MomentumAI.parseTask(prompt);
      return;
    }

    const priority = priorityInput.value;
    const dueDate = dueDateInput.value;
    const dueTime = dueTimeInput.value;
    const projectId = projectInput.value || null;
    const rawTags = tagsInput.value;

    const tags = normalizeTags(rawTags.split(","));

    try {
      await WorkspaceRepository.createTask({
        title,
        priority,
        dueDate,
        dueTime,
        projectId,
        tags
      });

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
      showToast("Task created", 2000);
    } catch (err) {
      console.error("Task creation failed:", err);
      showToast(err.message || "Failed to create task.", 3500);
    }
  });

  // Mobile Task Creation (Bottom Sheet)
  mobileTodoForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const title = mobileTodoInput.value.trim();
    if (!title) return;

    if (title.toLowerCase().startsWith("ai:") || title.toLowerCase().startsWith("/ai ") || title.toLowerCase().startsWith("!ai ")) {
      const prompt = title.replace(/^(ai:|\/ai|!ai)\s*/i, "").trim();
      mobileTodoInput.value = "";
      closeMobileBottomSheet();
      MomentumAI.parseTask(prompt);
      return;
    }

    const priority = mobilePriorityInput.value;
    const dueDate = mobileDueDateInput.value;
    const dueTime = mobileDueTimeInput.value;
    const projectId = mobileProjectInput.value || null;
    const rawTags = mobileTagsInput.value;

    const tags = normalizeTags(rawTags.split(","));

    try {
      await WorkspaceRepository.createTask({
        title,
        priority,
        dueDate,
        dueTime,
        projectId,
        tags
      });

      closeMobileBottomSheet();
      showToast("Task created", 2000);
    } catch (err) {
      console.error("Task creation failed:", err);
      showToast(err.message || "Failed to create task.", 3500);
    }
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
      WorkspaceRepository.updateSortPreference(state.sort);
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
// 27C. MOMENTUM INTELLIGENCE LAYER (STAGE 6)
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

const MomentumAI = {
  _disclosureCallback: null,
  _pendingTaskProposal: null,
  _pendingProjectProposal: null,
  _pendingMutation: null,
  _currentPlan: null,

  hasConsent() {
    return localStorage.getItem("momentum_ai_consent") === "true";
  },

  setConsent(allowed) {
    localStorage.setItem("momentum_ai_consent", allowed ? "true" : "false");
  },

  async ensureAvailable() {
    if (!WorkspaceRepository.isCloud()) {
      showToast("Momentum Intelligence requires Cloud Workspace. Sign in to continue.", 4000);
      if (typeof AuthManager !== "undefined" && typeof AuthManager.openSignIn === "function") {
        AuthManager.openSignIn();
      }
      return false;
    }

    if (!this.hasConsent()) {
      return new Promise((resolve) => {
        this.openDisclosureModal((accepted) => {
          resolve(accepted);
        });
      });
    }

    return true;
  },

  openDisclosureModal(callback) {
    this._disclosureCallback = callback;
    const overlay = document.getElementById("aiDisclosureModalOverlay");
    if (overlay) {
      overlay.classList.add("active");
      overlay.setAttribute("aria-hidden", "false");
    }
  },

  closeDisclosureModal() {
    const overlay = document.getElementById("aiDisclosureModalOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
    if (this._disclosureCallback) {
      this._disclosureCallback(false);
      this._disclosureCallback = null;
    }
  },

  acceptDisclosure() {
    this.setConsent(true);
    const overlay = document.getElementById("aiDisclosureModalOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
    if (this._disclosureCallback) {
      this._disclosureCallback(true);
      this._disclosureCallback = null;
    }
    showToast("Momentum Intelligence enabled ✓", 3000);
  },

  async apiCall(endpoint, payload = {}) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const res = await ApiClient.request(`/ai`, {
      method: "POST",
      body: { action: endpoint, ...payload, timezone: tz }
    });
    return res.data;
  },

  // 1. Natural Language Task Creation
  async parseTask(input) {
    const available = await this.ensureAvailable();
    if (!available) return;

    showToast("Analyzing task with Momentum Intelligence…", 2000);
    try {
      const data = await this.apiCall("parse-task", { input });
      if (data && data.proposal) {
        this.openTaskPreviewModal(data.proposal);
      }
    } catch (err) {
      console.error("AI parse task error:", err);
      showToast(err.message || "Failed to parse task with AI.", 3500);
    }
  },

  openTaskPreviewModal(proposal) {
    const overlay = document.getElementById("aiTaskPreviewModalOverlay");
    const titleInput = document.getElementById("aiPreviewTitleInput");
    const prioritySelect = document.getElementById("aiPreviewPrioritySelect");
    const projectSelect = document.getElementById("aiPreviewProjectSelect");
    const dueDateInput = document.getElementById("aiPreviewDueDateInput");
    const dueTimeInput = document.getElementById("aiPreviewDueTimeInput");
    const recurrenceSelect = document.getElementById("aiPreviewRecurrenceSelect");
    const tagsInput = document.getElementById("aiPreviewTagsInput");

    if (projectSelect) {
      projectSelect.innerHTML = '<option value="">Inbox</option>';
      (state.projects || []).forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        projectSelect.appendChild(opt);
      });
      if (proposal.matchedProjectId) {
        projectSelect.value = proposal.matchedProjectId;
      }
    }

    if (titleInput) titleInput.value = proposal.title || "";
    if (prioritySelect) prioritySelect.value = proposal.priority || "medium";
    if (dueDateInput) dueDateInput.value = proposal.dueDate || "";
    if (dueTimeInput) dueTimeInput.value = proposal.dueTime || "";
    if (recurrenceSelect) recurrenceSelect.value = proposal.recurrence || "none";
    if (tagsInput) tagsInput.value = (proposal.tags || []).join(", ");

    this._pendingTaskProposal = proposal;

    if (overlay) {
      overlay.classList.add("active");
      overlay.setAttribute("aria-hidden", "false");
      setTimeout(() => titleInput?.focus(), 50);
    }
  },

  closeTaskPreviewModal() {
    const overlay = document.getElementById("aiTaskPreviewModalOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
    this._pendingTaskProposal = null;
  },

  async confirmTaskPreview() {
    const titleInput = document.getElementById("aiPreviewTitleInput");
    const prioritySelect = document.getElementById("aiPreviewPrioritySelect");
    const projectSelect = document.getElementById("aiPreviewProjectSelect");
    const dueDateInput = document.getElementById("aiPreviewDueDateInput");
    const dueTimeInput = document.getElementById("aiPreviewDueTimeInput");
    const recurrenceSelect = document.getElementById("aiPreviewRecurrenceSelect");
    const tagsInput = document.getElementById("aiPreviewTagsInput");

    const title = (titleInput?.value || "").trim();
    if (!title) {
      showToast("Task title cannot be empty.", 3000);
      return;
    }

    const tags = (tagsInput?.value || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const taskData = {
      title,
      description: this._pendingTaskProposal?.description || "",
      priority: prioritySelect?.value || "medium",
      projectId: projectSelect?.value || null,
      dueDate: dueDateInput?.value || null,
      dueTime: dueTimeInput?.value || null,
      recurrence: recurrenceSelect?.value || "none",
      reminder: this._pendingTaskProposal?.reminder || null,
      tags
    };

    try {
      await WorkspaceRepository.createTask(taskData);
      this.closeTaskPreviewModal();
      showToast("Task created with Momentum Intelligence ✓", 3000);
    } catch (err) {
      showToast("Failed to create task: " + err.message, 3500);
    }
  },

  // 2. Plan My Day
  async openPlanDay() {
    const available = await this.ensureAvailable();
    if (!available) return;

    const overlay = document.getElementById("planMyDayModalOverlay");
    const loading = document.getElementById("planDayLoadingState");
    const content = document.getElementById("planDayContent");
    const focusText = document.getElementById("planDayFocusText");
    const dateBadge = document.getElementById("planDayDateBadge");
    const blocksList = document.getElementById("planDayBlocksList");
    const disclaimer = document.getElementById("planDayDisclaimer");

    if (overlay) {
      overlay.classList.add("active");
      overlay.setAttribute("aria-hidden", "false");
    }
    if (loading) loading.style.display = "flex";
    if (content) content.style.display = "none";

    try {
      const data = await this.apiCall("plan-day", {});
      if (loading) loading.style.display = "none";
      if (content) content.style.display = "block";

      const plan = data?.plan;
      if (!plan) throw new Error("No plan returned.");

      this._currentPlan = plan;
      if (focusText) focusText.textContent = plan.focus || "Focus on your highest priority goals today.";
      if (dateBadge) dateBadge.textContent = plan.date || "Today";
      if (disclaimer) disclaimer.textContent = plan.disclaimer || "Suggested schedule.";

      if (blocksList) {
        blocksList.innerHTML = "";
        (plan.blocks || []).forEach((b) => {
          const item = document.createElement("div");
          item.className = "plan-block-item" + (b.taskId ? " has-task" : " focus-block");

          const timeSpan = document.createElement("div");
          timeSpan.className = "plan-block-time";
          timeSpan.textContent = b.startTime && b.endTime ? `${b.startTime} - ${b.endTime}` : (b.startTime || "Anytime");

          const details = document.createElement("div");
          details.className = "plan-block-details";

          const title = document.createElement("div");
          title.className = "plan-block-title";
          title.textContent = b.title;

          details.appendChild(title);
          if (b.notes) {
            const notes = document.createElement("div");
            notes.className = "plan-block-notes";
            notes.textContent = b.notes;
            details.appendChild(notes);
          }

          item.appendChild(timeSpan);
          item.appendChild(details);
          blocksList.appendChild(item);
        });
      }
    } catch (err) {
      if (loading) loading.style.display = "none";
      showToast(err.message || "Failed to generate day plan.", 3500);
      this.closePlanDay();
    }
  },

  closePlanDay() {
    const overlay = document.getElementById("planMyDayModalOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
    this._currentPlan = null;
  },

  async acceptPlanDay() {
    this.closePlanDay();
    showToast("Day plan applied to Today view ✓", 3000);
    setView("today");
  },

  // 3. Break Down Task (in task drawer)
  async breakDownActiveTask() {
    const available = await this.ensureAvailable();
    if (!available) return;

    const taskId = state.activeDrawerTodoId;
    if (!taskId) return;

    const container = document.getElementById("drawerBreakDownAiContainer");
    const btn = document.getElementById("drawerBreakDownAiBtn");

    if (btn) btn.disabled = true;
    if (container) {
      container.style.display = "block";
      container.innerHTML = `
        <div class="ai-thinking-state-sm">
          <div class="ai-thinking-spinner-sm"></div>
          <span>Decomposing task with AI…</span>
        </div>
      `;
    }

    try {
      const data = await this.apiCall("break-down", { taskId });
      const subtasks = data?.subtasks || [];
      if (btn) btn.disabled = false;

      if (!subtasks.length) {
        if (container) container.innerHTML = '<p class="ai-subtext">No subtasks suggested.</p>';
        return;
      }

      container.innerHTML = `
        <div class="ai-breakdown-card">
          <div class="ai-breakdown-card-header">
            <span class="ai-breakdown-badge">Suggested Subtasks</span>
            <button id="discardBreakDownBtn" class="icon-btn-tiny" type="button" aria-label="Discard suggestions">✕</button>
          </div>
          <div class="ai-breakdown-items-list" id="aiBreakDownList">
            ${subtasks.map((st, idx) => `
              <label class="ai-breakdown-item">
                <input type="checkbox" checked data-idx="${idx}">
                <input type="text" class="ai-breakdown-item-input" value="${escapeHtml(st.title)}" data-idx="${idx}">
              </label>
            `).join("")}
          </div>
          <div class="ai-breakdown-card-footer">
            <button id="applyBreakDownBtn" class="primary-btn btn-sm" type="button">Add Selected (${subtasks.length})</button>
          </div>
        </div>
      `;

      document.getElementById("discardBreakDownBtn")?.addEventListener("click", () => {
        container.style.display = "none";
        container.innerHTML = "";
      });

      document.getElementById("applyBreakDownBtn")?.addEventListener("click", async () => {
        const checkboxes = container.querySelectorAll("input[type='checkbox'][data-idx]");
        const inputs = container.querySelectorAll(".ai-breakdown-item-input[data-idx]");

        let addedCount = 0;
        for (let i = 0; i < checkboxes.length; i++) {
          if (checkboxes[i].checked) {
            const title = inputs[i].value.trim();
            if (title) {
              await WorkspaceRepository.createSubtask(taskId, { title, completed: false });
              addedCount++;
            }
          }
        }

        container.style.display = "none";
        container.innerHTML = "";

        const fresh = state.todos.find((t) => t.id === taskId);
        if (fresh) renderDrawerSubtasks(fresh);
        showToast(`Added ${addedCount} subtasks ✓`, 3000);
      });
    } catch (err) {
      if (btn) btn.disabled = false;
      if (container) container.style.display = "none";
      showToast(err.message || "Failed to break down task.", 3500);
    }
  },

  // 4. AI Project Planner
  openProjectPlanner() {
    this.ensureAvailable().then((available) => {
      if (!available) return;
      const overlay = document.getElementById("projectPlannerModalOverlay");
      const inputSec = document.getElementById("projectPlannerInputSection");
      const loading = document.getElementById("projectPlannerLoadingState");
      const resultsSec = document.getElementById("projectPlannerResultsSection");
      const footer = document.getElementById("projectPlannerFooter");
      const goalInput = document.getElementById("projectPlannerGoalInput");

      if (inputSec) inputSec.style.display = "block";
      if (loading) loading.style.display = "none";
      if (resultsSec) resultsSec.style.display = "none";
      if (footer) footer.style.display = "none";
      if (goalInput) goalInput.value = "";

      if (overlay) {
        overlay.classList.add("active");
        overlay.setAttribute("aria-hidden", "false");
        setTimeout(() => goalInput?.focus(), 50);
      }
    });
  },

  closeProjectPlanner() {
    const overlay = document.getElementById("projectPlannerModalOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
    this._pendingProjectProposal = null;
  },

  async generateProjectPlan() {
    const goalInput = document.getElementById("projectPlannerGoalInput");
    const targetDateInput = document.getElementById("projectPlannerTargetDate");
    const inputSec = document.getElementById("projectPlannerInputSection");
    const loading = document.getElementById("projectPlannerLoadingState");
    const resultsSec = document.getElementById("projectPlannerResultsSection");
    const footer = document.getElementById("projectPlannerFooter");

    const goal = (goalInput?.value || "").trim();
    if (!goal) {
      showToast("Please enter a goal or project description.", 3000);
      return;
    }

    if (inputSec) inputSec.style.display = "none";
    if (loading) loading.style.display = "flex";

    try {
      const data = await this.apiCall("project-plan", {
        goal,
        targetDate: targetDateInput?.value || undefined
      });

      if (loading) loading.style.display = "none";

      const proposal = data?.proposal;
      if (!proposal) throw new Error("No proposal returned.");

      this._pendingProjectProposal = proposal;

      if (resultsSec) resultsSec.style.display = "block";
      if (footer) footer.style.display = "flex";

      const nameEl = document.getElementById("plannerProposedName");
      const descEl = document.getElementById("plannerProposedDesc");
      const countEl = document.getElementById("plannerTaskCountBadge");
      const listEl = document.getElementById("plannerTasksList");

      if (nameEl) nameEl.textContent = proposal.projectName;
      if (descEl) descEl.textContent = proposal.description;
      if (countEl) countEl.textContent = `${(proposal.tasks || []).length} proposed tasks`;

      if (listEl) {
        listEl.innerHTML = (proposal.tasks || []).map((t) => `
          <div class="planner-task-card">
            <div class="planner-task-header">
              <span class="planner-task-title">${escapeHtml(t.title)}</span>
              <span class="badge priority-${t.priority}">${t.priority}</span>
            </div>
            <div class="planner-task-meta">
              ${t.dueDate ? `<span class="planner-meta-date">📅 ${t.dueDate}</span>` : ""}
              ${(t.tags || []).map((tag) => `<span class="tag-badge">#${escapeHtml(tag)}</span>`).join("")}
            </div>
            ${(t.subtasks && t.subtasks.length) ? `
              <ul class="planner-task-subtasks">
                ${t.subtasks.map((st) => `<li>${escapeHtml(st)}</li>`).join("")}
              </ul>
            ` : ""}
          </div>
        `).join("");
      }
    } catch (err) {
      if (loading) loading.style.display = "none";
      if (inputSec) inputSec.style.display = "block";
      showToast(err.message || "Failed to generate project plan.", 3500);
    }
  },

  async commitProjectPlan() {
    const proposal = this._pendingProjectProposal;
    if (!proposal) return;

    try {
      showToast("Creating project and tasks…", 2000);

      const color = PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)] || "#8b5cf6";
      const createdProject = await WorkspaceRepository.createProject({
        name: proposal.projectName,
        color
      });

      for (const t of (proposal.tasks || [])) {
        await WorkspaceRepository.createTask({
          title: t.title,
          description: "",
          priority: t.priority || "medium",
          projectId: createdProject.id,
          dueDate: t.dueDate || null,
          dueTime: null,
          tags: t.tags || [],
          subtasks: (t.subtasks || []).map((stTitle) => ({ title: stTitle, completed: false }))
        });
      }

      this.closeProjectPlanner();
      showToast(`Created project "${proposal.projectName}" with ${proposal.tasks.length} tasks ✓`, 4000);
      setView(`project:${createdProject.id}`);
    } catch (err) {
      showToast("Failed to create project: " + err.message, 3500);
    }
  },

  // 5. Briefing
  async openBriefing() {
    const available = await this.ensureAvailable();
    if (!available) return;

    const overlay = document.getElementById("briefingModalOverlay");
    const loading = document.getElementById("briefingLoadingState");
    const content = document.getElementById("briefingContent");

    if (overlay) {
      overlay.classList.add("active");
      overlay.setAttribute("aria-hidden", "false");
    }
    if (loading) loading.style.display = "flex";
    if (content) content.style.display = "none";

    try {
      const data = await this.apiCall("briefing", {});
      if (loading) loading.style.display = "none";
      if (content) content.style.display = "block";

      const { stats, greeting, summary } = data || {};
      const greetingEl = document.getElementById("briefingGreeting");
      const summaryEl = document.getElementById("briefingSummary");
      if (greetingEl) greetingEl.textContent = greeting || "Good morning.";
      if (summaryEl) summaryEl.textContent = summary || "Here is your morning briefing.";

      if (stats) {
        const dueToday = document.getElementById("briefingDueTodayCount");
        const overdue = document.getElementById("briefingOverdueCount");
        const high = document.getElementById("briefingHighPriorityCount");
        const total = document.getElementById("briefingTotalOpenCount");

        if (dueToday) dueToday.textContent = stats.dueToday ?? 0;
        if (overdue) overdue.textContent = stats.overdue ?? 0;
        if (high) high.textContent = stats.highPriority ?? 0;
        if (total) total.textContent = stats.totalOpen ?? 0;

        const topTaskWrap = document.getElementById("briefingTopTaskWrap");
        const topTaskTitle = document.getElementById("briefingTopTaskTitle");
        if (stats.topTaskTitle && topTaskWrap && topTaskTitle) {
          topTaskWrap.style.display = "block";
          topTaskTitle.textContent = stats.topTaskTitle;
        } else if (topTaskWrap) {
          topTaskWrap.style.display = "none";
        }
      }
    } catch (err) {
      if (loading) loading.style.display = "none";
      showToast(err.message || "Failed to load briefing.", 3500);
      this.closeBriefing();
    }
  },

  closeBriefing() {
    const overlay = document.getElementById("briefingModalOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
  },

  // 6. Weekly Review
  async openWeeklyReview() {
    const available = await this.ensureAvailable();
    if (!available) return;

    const overlay = document.getElementById("weeklyReviewModalOverlay");
    const loading = document.getElementById("weeklyReviewLoadingState");
    const content = document.getElementById("weeklyReviewContent");

    if (overlay) {
      overlay.classList.add("active");
      overlay.setAttribute("aria-hidden", "false");
    }
    if (loading) loading.style.display = "flex";
    if (content) content.style.display = "none";

    try {
      const data = await this.apiCall("weekly-review", {});
      if (loading) loading.style.display = "none";
      if (content) content.style.display = "block";

      const { stats, weekStart, weekEnd, narrative, nextWeekPreview } = data || {};

      const rangeEl = document.getElementById("reviewDateRangeText");
      if (rangeEl) rangeEl.textContent = `${weekStart} to ${weekEnd}`;

      if (stats) {
        const comp = document.getElementById("reviewCompletedCount");
        const creat = document.getElementById("reviewCreatedCount");
        const opn = document.getElementById("reviewOpenCount");
        const best = document.getElementById("reviewBestDay");

        if (comp) comp.textContent = stats.completed ?? 0;
        if (creat) creat.textContent = stats.created ?? 0;
        if (opn) opn.textContent = stats.stillOpen ?? 0;
        if (best) best.textContent = stats.mostProductiveDay || "—";
      }

      const narrEl = document.getElementById("reviewNarrativeText");
      const nextEl = document.getElementById("reviewNextWeekText");
      if (narrEl) narrEl.textContent = narrative || "Steady productivity this week.";
      if (nextEl) nextEl.textContent = nextWeekPreview || "Ready for next week.";
    } catch (err) {
      if (loading) loading.style.display = "none";
      showToast(err.message || "Failed to load weekly review.", 3500);
      this.closeWeeklyReview();
    }
  },

  closeWeeklyReview() {
    const overlay = document.getElementById("weeklyReviewModalOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
  },

  // 7. Intelligence Hub launcher
  openHub() {
    const overlay = document.getElementById("intelligenceHubModalOverlay");
    const input = document.getElementById("aiHubNlInput");
    if (overlay) {
      overlay.classList.add("active");
      overlay.setAttribute("aria-hidden", "false");
      setTimeout(() => input?.focus(), 50);
    }
  },

  closeHub() {
    const overlay = document.getElementById("intelligenceHubModalOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
  },

  // 8. Command Intent Handler (Natural language actions)
  async handleCommandQuery(query) {
    const available = await this.ensureAvailable();
    if (!available) return;

    showToast("Interpreting with Momentum Intelligence…", 2000);
    try {
      const intentResult = await this.apiCall("command-intent", { query });
      if (!intentResult) throw new Error("No intent response.");

      this.executeIntent(intentResult);
    } catch (err) {
      showToast(err.message || "Could not process AI command.", 3500);
    }
  },

  async executeIntent(intentResult) {
    const { intent, params, naturalResponse } = intentResult;

    switch (intent) {
      case "CREATE_TASK":
        if (params?.taskInput) {
          this.parseTask(params.taskInput);
        } else {
          expandComposer();
          todoInput.focus();
        }
        break;

      case "SEARCH_TASKS":
        closeCommandPalette();
        if (params?.taskInput) {
          searchInput.value = params.taskInput;
          state.searchQuery = params.taskInput;
          render();
        }
        break;

      case "PLAN_DAY":
        closeCommandPalette();
        this.openPlanDay();
        break;

      case "SHOW_BRIEFING":
        closeCommandPalette();
        this.openBriefing();
        break;

      case "SHOW_WEEKLY_REVIEW":
        closeCommandPalette();
        this.openWeeklyReview();
        break;

      case "CREATE_PROJECT_PLAN":
        closeCommandPalette();
        this.openProjectPlanner();
        break;

      case "BREAK_DOWN_TASK":
        closeCommandPalette();
        if (state.activeDrawerTodoId) {
          this.breakDownActiveTask();
        } else {
          showToast("Select a task first to break it down with AI.", 3500);
        }
        break;

      case "UPDATE_TASK":
      case "UPDATE_TASKS":
        this.openBulkConfirmModal(intentResult);
        break;

      default:
        showToast(naturalResponse || "Command not recognized. Try 'Plan my day' or 'Add task buy milk tomorrow'.", 4000);
        break;
    }
  },

  openBulkConfirmModal(intentResult) {
    const overlay = document.getElementById("bulkConfirmModalOverlay");
    const descEl = document.getElementById("bulkConfirmDescription");
    const itemsEl = document.getElementById("bulkConfirmItemsList");

    this._pendingMutation = intentResult;

    if (descEl) {
      descEl.textContent = intentResult.naturalResponse || "Apply the following workspace changes?";
    }

    if (itemsEl) {
      const changes = intentResult.params?.changes || {};
      const changeStrings = [];
      if (changes.dueDate) changeStrings.push(`Due date → ${changes.dueDate}`);
      if (changes.priority) changeStrings.push(`Priority → ${changes.priority}`);
      if (changes.completed !== null && changes.completed !== undefined) {
        changeStrings.push(`Status → ${changes.completed ? "Completed" : "Open"}`);
      }

      itemsEl.innerHTML = `
        <div class="bulk-confirm-summary-box">
          <p><strong>Proposed changes:</strong> ${changeStrings.join(", ") || "Update task details"}</p>
        </div>
      `;
    }

    if (overlay) {
      overlay.classList.add("active");
      overlay.setAttribute("aria-hidden", "false");
    }
  },

  closeBulkConfirmModal() {
    const overlay = document.getElementById("bulkConfirmModalOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
    this._pendingMutation = null;
  },

  async applyBulkConfirm() {
    const mutation = this._pendingMutation;
    this.closeBulkConfirmModal();
    if (!mutation) return;

    try {
      const { params } = mutation;
      const changes = params?.changes || {};

      if (params?.taskRef) {
        await WorkspaceRepository.updateTask(params.taskRef, changes);
        showToast("Task updated ✓", 3000);
      } else {
        showToast("Changes applied ✓", 3000);
      }
    } catch (err) {
      showToast("Failed to apply changes: " + err.message, 3500);
    }
  },

  // Setup DOM Event Listeners
  setupListeners() {
    // 1. Sidebar Intelligence entry
    document.getElementById("navItemIntelligence")?.addEventListener("click", () => {
      this.openHub();
    });

    // 2. Hero action buttons
    document.getElementById("heroPlanDayBtn")?.addEventListener("click", () => {
      this.openPlanDay();
    });
    document.getElementById("heroBriefingBtn")?.addEventListener("click", () => {
      this.openBriefing();
    });

    // 3. Task details drawer breakdown button
    document.getElementById("drawerBreakDownAiBtn")?.addEventListener("click", () => {
      this.breakDownActiveTask();
    });

    // 4. Disclosure modal
    document.getElementById("closeAiDisclosureBtn")?.addEventListener("click", () => this.closeDisclosureModal());
    document.getElementById("cancelAiDisclosureBtn")?.addEventListener("click", () => this.closeDisclosureModal());
    document.getElementById("acceptAiDisclosureBtn")?.addEventListener("click", () => this.acceptDisclosure());
    const aiDiscOverlay = document.getElementById("aiDisclosureModalOverlay");
    aiDiscOverlay?.addEventListener("click", (e) => {
      if (e.target === aiDiscOverlay) this.closeDisclosureModal();
    });

    // 5. Task preview modal
    document.getElementById("closeAiTaskPreviewBtn")?.addEventListener("click", () => this.closeTaskPreviewModal());
    document.getElementById("cancelAiTaskPreviewBtn")?.addEventListener("click", () => this.closeTaskPreviewModal());
    document.getElementById("confirmAiTaskPreviewBtn")?.addEventListener("click", () => this.confirmTaskPreview());
    const aiPrevOverlay = document.getElementById("aiTaskPreviewModalOverlay");
    aiPrevOverlay?.addEventListener("click", (e) => {
      if (e.target === aiPrevOverlay) this.closeTaskPreviewModal();
    });

    // 6. Plan My Day modal
    document.getElementById("closePlanMyDayBtn")?.addEventListener("click", () => this.closePlanDay());
    document.getElementById("regeneratePlanDayBtn")?.addEventListener("click", () => this.openPlanDay());
    document.getElementById("acceptPlanDayBtn")?.addEventListener("click", () => this.acceptPlanDay());
    const planDayOverlay = document.getElementById("planMyDayModalOverlay");
    planDayOverlay?.addEventListener("click", (e) => {
      if (e.target === planDayOverlay) this.closePlanDay();
    });

    // 7. Project Planner modal
    document.getElementById("closeProjectPlannerBtn")?.addEventListener("click", () => this.closeProjectPlanner());
    document.getElementById("generateProjectPlanBtn")?.addEventListener("click", () => this.generateProjectPlan());
    document.getElementById("cancelProjectPlanBtn")?.addEventListener("click", () => this.closeProjectPlanner());
    document.getElementById("commitProjectPlanBtn")?.addEventListener("click", () => this.commitProjectPlan());
    const projPlanOverlay = document.getElementById("projectPlannerModalOverlay");
    projPlanOverlay?.addEventListener("click", (e) => {
      if (e.target === projPlanOverlay) this.closeProjectPlanner();
    });

    // 8. Briefing modal
    document.getElementById("closeBriefingModalBtn")?.addEventListener("click", () => this.closeBriefing());
    document.getElementById("closeBriefingActionBtn")?.addEventListener("click", () => this.closeBriefing());
    document.getElementById("briefingPlanDayActionBtn")?.addEventListener("click", () => {
      this.closeBriefing();
      this.openPlanDay();
    });
    const briefOverlay = document.getElementById("briefingModalOverlay");
    briefOverlay?.addEventListener("click", (e) => {
      if (e.target === briefOverlay) this.closeBriefing();
    });

    // 9. Weekly Review modal
    document.getElementById("closeWeeklyReviewModalBtn")?.addEventListener("click", () => this.closeWeeklyReview());
    document.getElementById("closeWeeklyReviewActionBtn")?.addEventListener("click", () => this.closeWeeklyReview());
    const weekRevOverlay = document.getElementById("weeklyReviewModalOverlay");
    weekRevOverlay?.addEventListener("click", (e) => {
      if (e.target === weekRevOverlay) this.closeWeeklyReview();
    });

    // 10. Bulk Confirm modal
    document.getElementById("closeBulkConfirmBtn")?.addEventListener("click", () => this.closeBulkConfirmModal());
    document.getElementById("cancelBulkConfirmBtn")?.addEventListener("click", () => this.closeBulkConfirmModal());
    document.getElementById("acceptBulkConfirmBtn")?.addEventListener("click", () => this.applyBulkConfirm());
    const bulkOverlay = document.getElementById("bulkConfirmModalOverlay");
    bulkOverlay?.addEventListener("click", (e) => {
      if (e.target === bulkOverlay) this.closeBulkConfirmModal();
    });

    // 11. Intelligence Hub modal
    document.getElementById("closeIntelligenceHubBtn")?.addEventListener("click", () => this.closeHub());
    const hubOverlay = document.getElementById("intelligenceHubModalOverlay");
    hubOverlay?.addEventListener("click", (e) => {
      if (e.target === hubOverlay) this.closeHub();
    });

    const hubInput = document.getElementById("aiHubNlInput");
    const hubSubmit = document.getElementById("aiHubNlSubmitBtn");
    const executeHubNl = () => {
      const q = (hubInput?.value || "").trim();
      if (!q) return;
      this.closeHub();
      this.handleCommandQuery(q);
    };
    hubSubmit?.addEventListener("click", executeHubNl);
    hubInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") executeHubNl();
    });

    document.getElementById("aiHubPlanDayBtn")?.addEventListener("click", () => {
      this.closeHub();
      this.openPlanDay();
    });
    document.getElementById("aiHubBriefingBtn")?.addEventListener("click", () => {
      this.closeHub();
      this.openBriefing();
    });
    document.getElementById("aiHubProjectPlannerBtn")?.addEventListener("click", () => {
      this.closeHub();
      this.openProjectPlanner();
    });
    document.getElementById("aiHubWeeklyReviewBtn")?.addEventListener("click", () => {
      this.closeHub();
      this.openWeeklyReview();
    });
  }
};

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
ImportManager.setupListeners();
OnboardingManager.setupListeners();
AccountDataManager.setupListeners();
PrivacyManager.setupListeners();
FeedbackManager.setupListeners();
MomentumAI.setupListeners();
AuthManager.init();

// PWA Service Worker Registration
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[SW] Registration error:", err);
    });
  });
}

// Online / Offline Network Listeners
window.addEventListener("online", () => {
  showToast("Network restored. Momentum Cloud connected.", 3000);
});
window.addEventListener("offline", () => {
  showToast("You are offline. Changes will save locally.", 3500);
});

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
