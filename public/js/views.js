/**
 * Momentum — Search, calendar, main render loop, and secondary rail.
 * Classic script: shares global scope with the other files in /js, loaded in order by index.html.
 */

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
        <span class="cal-task-dot" style="background-color: ${escapeHtml(dotColor)};"></span>
        ${timeText ? `<span class="cal-task-time">${escapeHtml(timeText)}</span>` : ""}
        <span class="cal-task-title">${escapeHtml(task.title)}</span>
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
          <input type="checkbox" class="todo-toggle" ${task.completed ? "checked" : ""} aria-label="Toggle ${escapeHtml(task.title)}">
          <div>
            <p class="mobile-agenda-task-title">${escapeHtml(task.title)}</p>
            <div class="mobile-agenda-task-meta">
              ${proj ? `<span class="todo-meta-item">${escapeHtml(proj.name)}</span> · ` : ""}
              ${task.dueTime ? `<span>${escapeHtml(task.dueTime)}</span> · ` : ""}
              <span class="badge priority-${escapeHtml(task.priority)}">${escapeHtml(capitalize(task.priority))}</span>
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
let lastRenderedView = null;

function render() {
  const viewChanged = lastRenderedView !== state.currentView;
  lastRenderedView = state.currentView;

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
  Motion.setCount(statTodayCount, todayTasks.length);
  Motion.setCount(statOverdueCount, overdueTasks.length);
  Motion.setCount(statCompletedCount, completedTodos.length);
  const streak = calculateStreak(completedTodos);
  Motion.setCount(statStreakCount, streak);

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

    const prevRects = Motion.captureList(todoList);
    todoList.innerHTML = "";

    if (state.booting || (state.workspaceMode === "cloud" && state.cloudStatus === "loading")) {
      summaryText.textContent = "Syncing cloud workspace…";
      todoList.append(...buildSkeletonRows());
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
    Motion.playList(todoList, prevRects, { stagger: viewChanged });
  }

  if (viewChanged) {
    Motion.reveal([heroSubtitle, sectionSubheader, sectionHeader]);
    if (state.currentView === "calendar") Motion.reveal([calendarViewSection], { distance: 14 });
  }

  // Render Secondary Desktop Rail (Contextual)
  renderSecondaryRail();

  // Update Active Navigation State
  updateNavActiveStates();

  // Check and prompt workspace import if eligible
  ImportManager.checkAndPromptImport();

  // Offer reminders when tasks have them; open a task a notification asked for
  Reminders.renderPrompt(document.querySelector("#listReminderPrompt"));
  Reminders.applyPending();
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
    const isActive = item.dataset.view === state.currentView;
    item.classList.toggle("active", isActive);
    if (isActive) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  });
  moveNavIndicator();
}

/** Glides a single highlight pill between items in the main sidebar nav. */
function moveNavIndicator() {
  const list = document.querySelector(".app-sidebar .nav-list");
  if (!list) return;
  let indicator = list.querySelector(".nav-indicator");
  if (!indicator) {
    indicator = document.createElement("li");
    indicator.className = "nav-indicator";
    indicator.setAttribute("aria-hidden", "true");
    list.prepend(indicator);
    list.classList.add("has-nav-indicator");
  }
  const active = list.querySelector(".nav-item.active");
  if (!active || active.offsetParent === null) {
    indicator.classList.remove("is-visible");
    return;
  }
  const row = active.closest("li") || active;
  indicator.style.transform = `translateY(${row.offsetTop}px)`;
  indicator.style.height = `${active.offsetHeight}px`;
  // First placement snaps; later moves glide (transition is enabled by .is-ready).
  if (!indicator.classList.contains("is-visible")) {
    indicator.classList.add("is-visible");
    requestAnimationFrame(() => indicator.classList.add("is-ready"));
  }
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

/** Placeholder rows shaped like real tasks, so loading never shifts the layout. */
function buildSkeletonRows(count = 4) {
  return Array.from({ length: count }, (_, i) => {
    const li = document.createElement("li");
    li.className = "todo-item todo-skeleton";
    li.setAttribute("aria-hidden", "true");
    li.style.setProperty("--skeleton-delay", `${i * 120}ms`);
    li.innerHTML = `
      <span class="skeleton-block skeleton-circle"></span>
      <span class="skeleton-lines">
        <span class="skeleton-block skeleton-line" style="width: ${[72, 54, 64, 46][i % 4]}%"></span>
        <span class="skeleton-block skeleton-line skeleton-line-sm"></span>
      </span>
      <span class="skeleton-block skeleton-pill"></span>
    `;
    return li;
  });
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
    <p class="cloud-error-desc">${escapeHtml(errorMessage || "A temporary connection issue occurred while syncing with the server.")}</p>
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
  item.className = `motion-spotlight todo-item${todo.completed ? " done" : ""}${isCompleting ? " completing" : ""}`;
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
  const titleText = document.createElement("span");
  titleText.className = "todo-title-text";
  titleText.textContent = todo.title;
  title.append(titleText);
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
        <span class="rail-task-title">${escapeHtml(task.title)}</span>
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
        <span>${escapeHtml(proj.name)}</span>
        <span>${doneProj}/${totalProj}</span>
      </div>
      <div class="proj-snapshot-bar">
        <div class="proj-snapshot-fill" style="width: ${projPct}%; background-color: ${escapeHtml(proj.color || "#f08352")};"></div>
      </div>
    `;
    item.style.cursor = "pointer";
    item.addEventListener("click", () => {
      setView(`project:${proj.id}`);
    });
    projectsSnapshotList.append(item);
  });
}
