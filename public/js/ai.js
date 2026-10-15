/**
 * Momentum — Momentum Intelligence (AI) client layer.
 * Classic script: shares global scope with the other files in /js, loaded in order by index.html.
 */

// ==========================================================================
// 27C. MOMENTUM INTELLIGENCE LAYER (STAGE 6)
// ==========================================================================

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
      const why = "Sign in to use the AI assistant. It can plan your day and break big tasks into steps.";
      if (typeof AuthManager !== "undefined" && typeof AuthManager.openSignIn === "function") {
        AuthManager.openSignIn({ reason: why });
      } else {
        showToast(why, 4000);
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
    showToast("AI assistant turned on", 3000, null, "sparkles");
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

    showToast("Reading your task…", 2000);
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
      showToast("Task added", 3000, null, "sparkles");
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
    showToast("Day plan applied to Today view", 3000, null, "check");
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
            <button id="discardBreakDownBtn" class="icon-btn-tiny" type="button" aria-label="Discard suggestions">${ICONS.x}</button>
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
        showToast(`Added ${addedCount} subtasks`, 3000, null, "check");
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
              <span class="badge priority-${escapeHtml(t.priority)}">${escapeHtml(t.priority)}</span>
            </div>
            <div class="planner-task-meta">
              ${t.dueDate ? `<span class="planner-meta-date">${ICONS.calendar}${escapeHtml(t.dueDate)}</span>` : ""}
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
      showToast(`Created project "${proposal.projectName}" with ${proposal.tasks.length} tasks`, 4000, null, "check");
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
  async openHub() {
    // Signed out: go straight to sign-in, with the reason, instead of a hub of locked buttons.
    if (!WorkspaceRepository.isCloud()) {
      await this.ensureAvailable();
      return;
    }
    GettingStarted.markAiTried();
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

    showToast("Working on it…", 2000);
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
          <p><strong>Proposed changes:</strong> ${escapeHtml(changeStrings.join(", ") || "Update task details")}</p>
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
        showToast("Task updated", 3000, null, "check");
      } else {
        showToast("Changes applied", 3000, null, "check");
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
