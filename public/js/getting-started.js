/**
 * Momentum — Friendly first run (example tasks) and the "Getting started" checklist.
 * Classic script: shares global scope with the other files in /js, loaded in order by index.html.
 */

const GS_KEYS = {
  firstRunDone: "momentum-first-run-done",
  dismissed: "momentum-getting-started-dismissed",
  typedNaturally: "momentum-gs-typed-naturally",
  aiTried: "momentum-gs-ai-tried",
  installed: "momentum-gs-installed"
};

function gsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function gsSet(key, value = "1") {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: the card simply shows again next time
  }
}

/** Opens whichever task composer fits the screen. */
function focusTaskComposer() {
  if (window.innerWidth <= 767) {
    openMobileBottomSheet();
  } else {
    expandComposer();
    todoInput.focus();
  }
}

// ==========================================================================
// First run: "Start with 3 example tasks" or "Start empty"
// ==========================================================================
const FirstRun = {
  // Typed exactly as a person would, then run through smart typing, so the examples
  // show what the composer understands.
  EXAMPLES: [
    {
      typed: "Reply to Priya about the Q4 budget today, high priority #finance",
      note: "Example task. It was typed as: “Reply to Priya about the Q4 budget today, high priority #finance”. Momentum filled in the date, priority and tag. Delete it any time."
    },
    {
      typed: "Send weekly status update every Monday 9am",
      note: "Example task. It repeats every week: tick it off and next week’s copy appears. Typed as: “Send weekly status update every Monday 9am”. Delete it any time."
    },
    {
      typed: "Renew the office insurance next Friday",
      reminder: "1440",
      note: "Example task with a reminder 1 day before. Turn on reminders to get a heads-up on your phone or computer. Delete it any time."
    }
  ],

  shouldOffer() {
    if (state.booting || state.todos.length > 0 || gsGet(GS_KEYS.firstRunDone)) return false;
    if (state.workspaceMode === "cloud" && state.cloudStatus !== "connected") return false;
    return true;
  },

  finish() {
    gsSet(GS_KEYS.firstRunDone);
  },

  buildCard() {
    const li = document.createElement("li");
    li.className = "first-run-card";

    const title = document.createElement("h3");
    title.className = "first-run-title";
    title.textContent = "Welcome. Let’s get you started.";

    const text = document.createElement("p");
    text.className = "first-run-text";
    text.textContent = "See how Momentum works with three everyday examples, or start with a clean list.";

    const actions = document.createElement("div");
    actions.className = "first-run-actions";

    const examplesBtn = document.createElement("button");
    examplesBtn.type = "button";
    examplesBtn.className = "primary-btn first-run-primary";
    examplesBtn.textContent = "Start with 3 example tasks";
    examplesBtn.addEventListener("click", () => this.addExamples(examplesBtn));

    const emptyBtn = document.createElement("button");
    emptyBtn.type = "button";
    emptyBtn.className = "ghost-btn";
    emptyBtn.textContent = "Start empty";
    emptyBtn.addEventListener("click", () => {
      this.finish();
      render();
      focusTaskComposer();
    });

    actions.append(examplesBtn, emptyBtn);
    li.append(title, text, actions);
    return li;
  },

  async addExamples(button) {
    if (button) button.disabled = true;
    this.finish();
    const created = [];
    try {
      // Oldest first, so the list reads top-to-bottom in the order above.
      for (const ex of [...this.EXAMPLES].reverse()) {
        const parsed = SmartInput.parse(ex.typed);
        const todo = await WorkspaceRepository.createTask({
          title: parsed.title,
          description: ex.note,
          priority: parsed.priority || "medium",
          dueDate: parsed.dueDate || "",
          dueTime: parsed.dueTime || "",
          tags: ["example", ...parsed.tags],
          recurrence: parsed.recurrence || "none",
          reminder: ex.reminder || null
        });
        if (todo) created.push(todo.id);
      }
      showToast("Added 3 example tasks. Open one to see how it was made.", 5000, () => this.removeExamples(created), "sparkles");
    } catch (err) {
      console.error("Adding example tasks failed:", err);
      showToast("Couldn’t add the examples. You can start by typing your own task.", 4000);
    }
  },

  async removeExamples(ids) {
    for (const id of ids) {
      try {
        await WorkspaceRepository.deleteTask(id);
      } catch (err) {
        console.warn("Could not remove example task", err);
      }
    }
    try {
      localStorage.removeItem(GS_KEYS.firstRunDone);
    } catch {
      // ignore
    }
    render();
  }
};

// ==========================================================================
// "Getting started" checklist (rail on wide screens, top of the list elsewhere)
// ==========================================================================
const GettingStarted = {
  items() {
    const signedIn = typeof AuthManager !== "undefined" && AuthManager.isAuthenticated();
    const remindersStatus = Reminders.status();
    const items = [
      {
        id: "type",
        label: "Add a task by typing naturally",
        done: Boolean(gsGet(GS_KEYS.typedNaturally)),
        run: focusTaskComposer
      },
      {
        id: "reminders",
        label: remindersStatus === "denied" ? "Turn on reminders (blocked in your browser)" : "Turn on reminders",
        done: remindersStatus === "granted",
        run: async () => {
          if (remindersStatus === "default") {
            await Reminders.request();
            this.render();
          } else {
            ReminderSettingsPanel.open();
          }
        }
      },
      signedIn
        ? {
            id: "ai",
            label: "Try the AI assistant",
            done: Boolean(gsGet(GS_KEYS.aiTried)) || MomentumAI.hasConsent(),
            run: () => MomentumAI.openHub()
          }
        : {
            id: "ai",
            label: "Create a free account to try the AI assistant",
            done: false,
            run: () =>
              AuthManager.openSignIn({ reason: "With a free account you can use the AI assistant. It can plan your day and break big tasks into steps." })
          }
    ];
    if (typeof InstallHelper !== "undefined") {
      items.push({
        id: "install",
        label: "Install Momentum on your phone",
        done: InstallHelper.isInstalled() || Boolean(gsGet(GS_KEYS.installed)),
        run: () => InstallHelper.open()
      });
    }
    return items;
  },

  isVisible() {
    if (gsGet(GS_KEYS.dismissed) || state.booting) return false;
    const appShellEl = document.getElementById("appShell");
    if (!appShellEl || appShellEl.hidden) return false;
    // One step at a time: the first-run choice comes first.
    return !FirstRun.shouldOffer();
  },

  render() {
    const slots = [document.querySelector("#railGettingStarted"), document.querySelector("#listGettingStarted")];
    const visible = this.isVisible();
    const items = visible ? this.items() : [];
    slots.forEach((slot) => {
      if (!slot) return;
      slot.hidden = !visible;
      slot.textContent = "";
      if (visible) slot.append(this.buildCard(items));
    });
  },

  buildCard(items) {
    const doneCount = items.filter((i) => i.done).length;
    const allDone = doneCount === items.length;

    const card = document.createElement("section");
    card.className = "panel rail-card gs-card";
    card.setAttribute("aria-label", "Getting started");

    const header = document.createElement("div");
    header.className = "rail-card-header";
    const title = document.createElement("span");
    title.className = "rail-card-title";
    title.textContent = "Getting started";
    const right = document.createElement("div");
    right.className = "gs-header-right";
    const badge = document.createElement("span");
    badge.className = "rail-badge";
    badge.textContent = `${doneCount} of ${items.length}`;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "icon-btn gs-close";
    close.setAttribute("aria-label", "Hide getting started");
    close.title = "Hide";
    close.append(iconEl("x", 14));
    close.addEventListener("click", () => {
      gsSet(GS_KEYS.dismissed);
      this.render();
    });
    right.append(badge, close);
    header.append(title, right);

    const bar = document.createElement("div");
    bar.className = "progress-bar-wrap";
    const fill = document.createElement("div");
    fill.className = "progress-bar-fill";
    fill.style.width = `${Math.round((doneCount / items.length) * 100)}%`;
    bar.append(fill);

    const list = document.createElement("ul");
    list.className = "gs-list";
    items.forEach((item) => {
      const li = document.createElement("li");
      li.className = `gs-item${item.done ? " is-done" : ""}`;
      const mark = document.createElement("span");
      mark.className = "gs-check";
      mark.setAttribute("aria-hidden", "true");
      if (item.done) mark.append(iconEl("check", 12));

      if (item.done) {
        const label = document.createElement("span");
        label.className = "gs-label";
        label.textContent = item.label;
        const sr = document.createElement("span");
        sr.className = "sr-only";
        sr.textContent = " (done)";
        label.append(sr);
        li.append(mark, label);
      } else {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "gs-action";
        const label = document.createElement("span");
        label.className = "gs-label";
        label.textContent = item.label;
        btn.append(mark, label);
        btn.addEventListener("click", () => item.run());
        li.append(btn);
      }
      list.append(li);
    });

    card.append(header, bar, list);

    if (allDone) {
      const doneNote = document.createElement("p");
      doneNote.className = "rail-subtext";
      doneNote.textContent = "You’re all set. You can hide this now.";
      card.append(doneNote);
    }
    return card;
  },

  markTypedNaturally() {
    if (!gsGet(GS_KEYS.typedNaturally)) {
      gsSet(GS_KEYS.typedNaturally);
      this.render();
    }
  },

  markAiTried() {
    if (!gsGet(GS_KEYS.aiTried)) gsSet(GS_KEYS.aiTried);
  }
};
