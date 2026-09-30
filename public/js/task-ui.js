/**
 * Momentum — Task composer, details drawer, project modal, and task context menu.
 * Classic script: shares global scope with the other files in /js, loaded in order by index.html.
 */

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
    drawerSaveStatus.textContent = "Saved";
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
          drawerSaveStatus.textContent = "Saved";
          drawerSaveStatus.classList.remove("saving");
        }
      }
    });
  } else {
    if (drawerSaveStatus) {
      drawerSaveStatus.textContent = "Saved";
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
      <span>#${escapeHtml(tag)}</span>
      <button type="button" class="drawer-tag-remove" aria-label="Remove tag #${escapeHtml(tag)}">&times;</button>
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
      <span class="project-dot" style="background:${escapeHtml(proj.color)}"></span>
      <span>${escapeHtml(proj.name)}</span>
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
