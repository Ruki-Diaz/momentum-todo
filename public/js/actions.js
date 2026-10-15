/**
 * Momentum — Task CRUD, command palette, keyboard shortcuts, reminders, creation form.
 * Classic script: shares global scope with the other files in /js, loaded in order by index.html.
 */

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
      if (willBeDone) Motion.celebrate(chk);
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
          : "Task completed";
        showToast(toastMsg, 3000, null, nextOccurrence ? "calendar" : "party");
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
      showToast(err.message || "Couldn't save that change. Please try again.", 3500);
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
      Motion.celebrate(chk);
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
        : "Task completed";

      showToast(toastMsg, 3500, () => {
        state.undoManager.undo();
      }, generatedNextOccurrence ? "calendar" : "party");
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
      showToast(err.message || "Couldn't delete that task. Please try again.", 3500);
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
        showToast("Couldn't clear completed tasks. Please try again.", 3500);
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
  document.body.classList.add("sidebar-open");
}

function closeMobileSidebar() {
  appSidebar.classList.remove("open");
  sidebarOverlay.classList.remove("active");
  document.body.classList.remove("sidebar-open");
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
  if (mobileSmart) mobileSmart.reset();
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
    { title: "Today", meta: "View", icon: "sun", action: () => setView("today") },
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
      title: "New task",
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
    { title: "New project", meta: "Action", icon: "folder-plus", action: () => openProjectModal(null) },
    { title: "Clear completed tasks", meta: "Action", icon: "trash", action: () => clearCompleted() },
    { title: "Plan my day", meta: "AI", icon: "sparkles", action: () => MomentumAI.openPlanDay() },
    { title: "My day at a glance", meta: "AI", icon: "sparkles", action: () => MomentumAI.openBriefing() },
    { title: "Review my week", meta: "AI", icon: "sparkles", action: () => MomentumAI.openWeeklyReview() },
    { title: "Plan a project", meta: "AI", icon: "sparkles", action: () => MomentumAI.openProjectPlanner() },
    { title: "Switch light / dark", meta: "Action", icon: "moon", action: () => toggleTheme() },
    { title: "Download a backup", meta: "Action", icon: "download", action: () => DataStore.exportData() },
    { title: "Keyboard shortcuts", meta: "Help", icon: "help", action: () => openShortcutsModal() }
  ];

  if (AuthManager.isAuthenticated()) {
    actionDefs.push(
      { title: "Manage account", meta: "Account", icon: "user", action: () => AuthManager.openAccountManagement() },
      { title: "Sign out", meta: "Account", icon: "log-out", action: () => AuthManager.signOut() }
    );
  } else {
    actionDefs.push(
      { title: "Sign in or create a free account", meta: "Account", icon: "log-in", action: () => AuthManager.openSignIn() }
    );
  }

  const matchedActions = actionDefs.filter((a) => !needle || a.title.toLowerCase().includes(needle));

  // AI Natural Language Query Item
  const aiItems = [];
  if (needle && needle.length >= 2) {
    aiItems.push({
      title: `Ask the AI assistant: "${query.trim()}"`,
      meta: "AI",
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
  if (aiItems.length > 0) sections.push({ group: "AI assistant", items: aiItems });
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
    emptyDiv.innerHTML = `<span style="color: var(--muted);">Nothing found</span>`;
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
          ${item.color ? `<span class="project-dot" style="background:${escapeHtml(item.color)};"></span>` : ""}
          <span class="cmd-item-title">${escapeHtml(item.title)}</span>
        </div>
        <span class="cmd-item-meta">${escapeHtml(item.meta)}</span>
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
// 25. REMINDERS (system notifications via Reminders, in-page toast as fallback)
// ==========================================================================
/**
 * Fires each due reminder once (remembered across reloads). Runs every 30 s and whenever
 * the tab becomes visible again, so reminders missed while the page was hidden still show.
 * Reminders more than 12 hours late become one quiet "You missed this" toast instead.
 * These only run while the browser is open; see reminders.js for why.
 */
function checkReminders() {
  if (state.booting) return;
  const now = Date.now();
  const granted = Reminders.status() === "granted";
  const visible = document.visibilityState === "visible";
  const missed = [];

  state.todos.forEach((todo) => {
    const at = Reminders.reminderAt(todo);
    if (at === null) return;

    const snoozedUntil = Reminders.snoozedUntil(todo.id);
    if (snoozedUntil) {
      if (now < snoozedUntil) return;
      if (!granted && !visible) return;
      Reminders.clearSnooze(todo.id);
      deliverReminder(todo, granted);
      return;
    }

    const key = `${todo.id}@${at}`;
    if (now < at || Reminders.wasFired(key)) return;
    // Without system notifications, wait until the person is looking at the page.
    if (!granted && !visible) return;

    Reminders.markFired(key);
    if (now - at > 12 * 60 * 60 * 1000) {
      missed.push(todo);
    } else {
      deliverReminder(todo, granted);
    }
  });

  if (missed.length === 1) {
    showToast(`You missed this: "${missed[0].title}" (${formatDueDate(missed[0].dueDate, missed[0].dueTime)})`, 6000, null, "bell");
  } else if (missed.length > 1) {
    showToast(`You missed ${missed.length} reminders while Momentum was closed. They're in your list.`, 6000, null, "bell");
  }
}

async function deliverReminder(todo, granted) {
  if (granted && (await Reminders.show(todo))) return;
  showToast(`Reminder: "${todo.title}" is ${Reminders.dueWords(todo) || "due now"}`, 6000, null, "bell");
}

// ==========================================================================
// 26. TASK CREATION FORM LISTENERS
// ==========================================================================
// Smart typing controllers for the desktop composer and the mobile bottom sheet.
let desktopSmart = null;
let mobileSmart = null;

/** "Added: Call John · Tomorrow, 3:00 PM · repeats weekly" */
function describeCreatedTask(todo) {
  if (!todo) return "Task added";
  const parts = [`Added: ${todo.title}`];
  if (todo.dueDate) parts.push(formatDueDate(todo.dueDate, todo.dueTime));
  if (todo.recurrence && todo.recurrence !== "none") parts.push(`repeats ${RECURRENCE_WORDS[todo.recurrence] || todo.recurrence}`);
  return parts.join(" · ");
}

const RECURRENCE_WORDS = { daily: "every day", weekdays: "every weekday", weekly: "every week", monthly: "every month" };

function setupTaskCreationListeners() {
  desktopSmart = SmartInput.bindComposer({
    input: todoInput,
    fields: { priority: priorityInput, dueDate: dueDateInput, dueTime: dueTimeInput, tags: tagsInput },
    preview: document.querySelector("#composerSmartPreview"),
    hint: document.querySelector("#composerSmartHint")
  });
  mobileSmart = SmartInput.bindComposer({
    input: mobileTodoInput,
    fields: { priority: mobilePriorityInput, dueDate: mobileDueDateInput, dueTime: mobileDueTimeInput, tags: mobileTagsInput },
    preview: document.querySelector("#mobileSmartPreview"),
    hint: document.querySelector("#mobileSmartHint")
  });

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

    const smart = desktopSmart.result();
    if (!smart.title) return;

    try {
      const created = await WorkspaceRepository.createTask({
        title: smart.title,
        priority: smart.priority,
        dueDate: smart.dueDate,
        dueTime: smart.dueTime,
        projectId: projectInput.value || null,
        tags: smart.tags,
        recurrence: smart.recurrence
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

      desktopSmart.reset();
      collapseComposer();
      if (smart.understood > 0) GettingStarted.markTypedNaturally();
      showToast(describeCreatedTask(created), 3000, null, "check");
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

    const smart = mobileSmart.result();
    if (!smart.title) return;

    try {
      const created = await WorkspaceRepository.createTask({
        title: smart.title,
        priority: smart.priority,
        dueDate: smart.dueDate,
        dueTime: smart.dueTime,
        projectId: mobileProjectInput.value || null,
        tags: smart.tags,
        recurrence: smart.recurrence
      });

      closeMobileBottomSheet();
      if (smart.understood > 0) GettingStarted.markTypedNaturally();
      showToast(describeCreatedTask(created), 3000, null, "check");
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
