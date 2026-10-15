/**
 * Momentum — Reminders: system notifications, the friendly "Turn on reminders" card,
 * snooze, and the "Reminders & daily email" panel.
 * Classic script: shares global scope with the other files in /js, loaded in order by index.html.
 *
 * Honest limits: notifications are shown by the service worker while the browser (or the
 * installed app) is running. If the browser is fully closed nothing can fire; true
 * closed-browser push needs a server-side scheduler, which the free hosting plan doesn't have.
 * When the app is opened again, missed reminders are shown once (see checkReminders).
 */

const REMINDER_STORE = {
  fired: "momentum-reminders-fired",
  snooze: "momentum-reminders-snooze",
  notNow: "momentum-reminders-not-now"
};
const NOT_NOW_MS = 7 * 24 * 60 * 60 * 1000;
const SNOOZE_MS = 10 * 60 * 1000;
const MISSED_AFTER_MS = 12 * 60 * 60 * 1000;

function readJsonStore(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: reminders still work for this session
  }
}

const Reminders = {
  /** "granted" | "denied" | "default" | "unsupported" */
  status() {
    if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
      return "unsupported";
    }
    return Notification.permission;
  },

  isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  },

  isInstalled() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  },

  /** Only call from a user click: browsers ignore or penalise unprompted requests. */
  async request() {
    if (this.status() === "unsupported") return "unsupported";
    try {
      const result = await Notification.requestPermission();
      document.dispatchEvent(new CustomEvent("momentum:reminders-changed"));
      return result;
    } catch {
      return this.status();
    }
  },

  /** True when it's worth offering the "Turn on reminders" card. */
  shouldAsk() {
    if (this.status() !== "default") return false;
    const notNow = Number(localStorage.getItem(REMINDER_STORE.notNow) || 0);
    return !notNow || Date.now() - notNow > NOT_NOW_MS;
  },

  notNow() {
    try {
      localStorage.setItem(REMINDER_STORE.notNow, String(Date.now()));
    } catch {
      // ignore
    }
    document.dispatchEvent(new CustomEvent("momentum:reminders-changed"));
  },

  /** When a task's reminder is due (ms timestamp), or null. Tasks without a time use 9:00 AM. */
  reminderAt(todo) {
    if (!todo || todo.completed || !todo.dueDate || !todo.reminder) return null;
    const offset = parseInt(todo.reminder, 10);
    if (Number.isNaN(offset)) return null;
    const [y, m, d] = todo.dueDate.split("-").map(Number);
    const [hh, mm] = (todo.dueTime || "09:00").split(":").map(Number);
    return new Date(y, m - 1, d, hh, mm, 0, 0).getTime() - offset * 60000;
  },

  /** "due today at 3:00 PM", "due tomorrow", "due Oct 20, 9:00 AM" */
  dueWords(todo) {
    const when = formatDueDate(todo.dueDate, todo.dueTime);
    if (!when) return "";
    if (/^(Today|Tomorrow)/.test(when)) return `due ${when.replace(", ", " at ").replace(/^T/, "t")}`;
    return `due ${when}`;
  },

  /** Show a real system notification through the service worker. Resolves false if it couldn't. */
  async show(todo) {
    if (this.status() !== "granted") return false;
    const title = todo.title;
    const options = {
      body: `Reminder: ${this.dueWords(todo) || "it's time"}`,
      tag: `momentum-task-${todo.id}`,
      renotify: true,
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      data: { todoId: todo.id },
      actions: [
        { action: "done", title: "Mark done" },
        { action: "snooze", title: "Snooze 10 min" }
      ]
    };
    try {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error("no service worker")), 3000))
      ]);
      await reg.showNotification(title, options);
      return true;
    } catch {
      try {
        delete options.actions; // page-level notifications don't support actions
        new Notification(title, options);
        return true;
      } catch {
        return false;
      }
    }
  },

  // ---------- once-only bookkeeping (survives reloads) ----------
  wasFired(key) {
    return Boolean(readJsonStore(REMINDER_STORE.fired)[key]);
  },

  markFired(key) {
    const log = readJsonStore(REMINDER_STORE.fired);
    log[key] = Date.now();
    // Keep the log small: forget anything older than 30 days.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    Object.keys(log).forEach((k) => {
      if (log[k] < cutoff) delete log[k];
    });
    writeJsonStore(REMINDER_STORE.fired, log);
  },

  snoozedUntil(todoId) {
    return readJsonStore(REMINDER_STORE.snooze)[todoId] || null;
  },

  clearSnooze(todoId) {
    const map = readJsonStore(REMINDER_STORE.snooze);
    delete map[todoId];
    writeJsonStore(REMINDER_STORE.snooze, map);
  },

  snooze(todoId) {
    const map = readJsonStore(REMINDER_STORE.snooze);
    map[todoId] = Date.now() + SNOOZE_MS;
    writeJsonStore(REMINDER_STORE.snooze, map);
    const todo = state.todos.find((t) => t.id === todoId);
    showToast(todo ? `Snoozed "${todo.title}" for 10 minutes` : "Snoozed for 10 minutes", 3000, null, "clock");
  },

  // ---------- actions from notification buttons ----------
  handleAction(action, todoId) {
    const todo = state.todos.find((t) => t.id === todoId);
    if (!todo) return false;
    if (action === "done") {
      if (!todo.completed) toggleTodo(todoId);
    } else if (action === "snooze") {
      this.snooze(todoId);
    } else {
      openTaskDetails(todoId);
    }
    return true;
  },

  _pendingOpen: null,

  /** Called after each render: opens a task requested by a notification click (?task=<id>). */
  applyPending() {
    if (!this._pendingOpen || state.booting) return;
    if (this.handleAction("open", this._pendingOpen)) {
      this._pendingOpen = null;
    }
  },

  setupListeners() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        const data = event.data || {};
        if (data.type === "reminder-action" && data.todoId) {
          this.handleAction(data.action, data.todoId);
        }
      });
    }

    try {
      const params = new URLSearchParams(window.location.search);
      const taskId = params.get("task");
      if (taskId) {
        this._pendingOpen = taskId;
        params.delete("task");
        const rest = params.toString();
        history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
      }
    } catch {
      // ignore malformed URLs
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkReminders();
    });

    document.addEventListener("momentum:reminders-changed", () => {
      if (typeof GettingStarted !== "undefined") GettingStarted.render();
    });

    // Offer reminders the moment someone picks one in the task details.
    if (drawerReminderInput) {
      drawerReminderInput.addEventListener("change", () => {
        if (drawerReminderInput.value && this.shouldAsk()) {
          this.renderPrompt(document.querySelector("#drawerReminderPrompt"), { force: true });
        }
      });
    }

    ReminderSettingsPanel.setupListeners();
  },

  // ---------- the friendly inline card ----------
  /**
   * Fills `slot` with the "Turn on reminders" card when it makes sense. The card never
   * triggers the browser pop-up by itself; only the "Turn on reminders" button does.
   */
  renderPrompt(slot, { force = false } = {}) {
    if (!slot) return;
    const keepOpen = slot.dataset.state === "denied" || slot.dataset.state === "granted";
    if (keepOpen) return;

    const wanted = force || (this.shouldAsk() && state.todos.some((t) => !t.completed && t.reminder));
    if (!wanted || !this.shouldAsk()) {
      slot.hidden = true;
      slot.textContent = "";
      delete slot.dataset.state;
      return;
    }
    if (slot.dataset.state === "ask") {
      slot.hidden = false;
      return;
    }

    slot.textContent = "";
    slot.dataset.state = "ask";
    slot.hidden = false;
    slot.append(this.buildCard());
  },

  buildCard() {
    const card = document.createElement("div");
    card.className = "reminder-card";
    card.setAttribute("role", "region");
    card.setAttribute("aria-label", "Turn on reminders");

    const icon = document.createElement("span");
    icon.className = "reminder-card-icon";
    icon.append(iconEl("bell", 18));

    const body = document.createElement("div");
    body.className = "reminder-card-body";
    const text = document.createElement("p");
    text.className = "reminder-card-text";
    text.textContent = "Want a heads-up on your phone or computer when it's time?";
    const actions = document.createElement("div");
    actions.className = "reminder-card-actions";

    const turnOn = document.createElement("button");
    turnOn.type = "button";
    turnOn.className = "primary-btn btn-sm";
    turnOn.textContent = "Turn on reminders";

    const later = document.createElement("button");
    later.type = "button";
    later.className = "ghost-btn btn-sm";
    later.textContent = "Not now";

    actions.append(turnOn, later);
    body.append(text, actions);
    card.append(icon, body);

    const slotOf = () => card.parentElement;

    turnOn.addEventListener("click", async () => {
      const result = await this.request();
      const slot = slotOf();
      if (result === "granted") {
        text.textContent = "Reminders are on. You'll get a heads-up when it's time.";
        actions.remove();
        if (slot) slot.dataset.state = "granted";
        setTimeout(() => {
          if (slot && slot.dataset.state === "granted") {
            slot.hidden = true;
            slot.textContent = "";
            delete slot.dataset.state;
          }
        }, 4000);
      } else {
        text.textContent = this.blockedHelp();
        actions.textContent = "";
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "ghost-btn btn-sm";
        ok.textContent = "OK";
        ok.addEventListener("click", () => {
          if (slot) {
            slot.hidden = true;
            slot.textContent = "";
            slot.dataset.state = "closed";
          }
        });
        actions.append(ok);
        if (slot) slot.dataset.state = "denied";
      }
    });

    later.addEventListener("click", () => {
      const slot = slotOf();
      this.notNow();
      if (slot) {
        slot.hidden = true;
        slot.textContent = "";
        delete slot.dataset.state;
      }
    });

    return card;
  },

  blockedHelp() {
    if (this.isIOS()) {
      return "No problem. To allow them later, open Settings on your iPhone or iPad, tap Notifications, find Momentum and turn on Allow Notifications.";
    }
    return "No problem. To allow them later, click the lock or settings icon next to the web address, set Notifications to Allow, then reload the page.";
  },

  /** One plain-English sentence for the settings panel. */
  statusSentence() {
    const s = this.status();
    if (s === "granted") return "On. You'll get a heads-up on this device when a task's reminder is due.";
    if (s === "denied") return `Blocked by your browser. ${this.blockedHelp().replace(/^No problem\. /, "")}`;
    if (s === "default") return "Off. Turn them on to get a heads-up on this device when it's time.";
    if (this.isIOS() && !this.isInstalled()) {
      return "On iPhone and iPad, add Momentum to your Home Screen first (tap Share, then Add to Home Screen), open it from there, then turn reminders on.";
    }
    return "This browser can't show notifications. Reminders still appear inside Momentum while it's open.";
  }
};

// ==========================================================================
// "Reminders & daily email" panel (account menu)
// ==========================================================================
const ReminderSettingsPanel = {
  open() {
    const overlay = document.getElementById("reminderSettingsOverlay");
    if (!overlay) return;
    if (userProfileWrap) userProfileWrap.classList.remove("open");
    if (userProfileBtn) userProfileBtn.setAttribute("aria-expanded", "false");
    state.lastFocusedElement = document.activeElement;
    this.render();
    overlay.classList.add("active");
    overlay.setAttribute("aria-hidden", "false");
    setTimeout(() => document.getElementById("closeReminderSettingsBtn")?.focus(), 50);
  },

  close() {
    const overlay = document.getElementById("reminderSettingsOverlay");
    if (!overlay || !overlay.classList.contains("active")) return;
    overlay.classList.remove("active");
    overlay.setAttribute("aria-hidden", "true");
    if (state.lastFocusedElement && typeof state.lastFocusedElement.focus === "function") {
      state.lastFocusedElement.focus();
    }
  },

  render() {
    const statusText = document.getElementById("reminderStatusText");
    const turnOnBtn = document.getElementById("reminderTurnOnBtn");
    if (statusText) statusText.textContent = Reminders.statusSentence();
    if (turnOnBtn) turnOnBtn.hidden = Reminders.status() !== "default";

    const emailSection = document.getElementById("dailyEmailSection");
    const settings = state.cloudSettings;
    const available = WorkspaceRepository.isCloud() && settings && settings.dailyEmailAvailable;
    if (emailSection) emailSection.hidden = !available;
    if (!available) return;

    const toggle = document.getElementById("dailyEmailToggle");
    const hour = document.getElementById("dailyEmailHour");
    if (hour && hour.options.length === 0) {
      for (let h = 5; h <= 11; h++) {
        const opt = document.createElement("option");
        opt.value = String(h);
        opt.textContent = `around ${h} AM`;
        hour.append(opt);
      }
    }
    if (toggle) toggle.checked = Boolean(settings.dailyEmail);
    if (hour) {
      hour.value = String(settings.dailyEmailHour ?? 8);
      if (!hour.value) hour.value = "8";
      hour.disabled = !settings.dailyEmail;
    }
  },

  save(fields) {
    state.cloudSettings = { ...(state.cloudSettings || {}), ...fields };
    CloudDataStore.queueSettingsSave(fields);
    this.render();
  },

  setupListeners() {
    document.getElementById("menuRemindersBtn")?.addEventListener("click", () => this.open());
    document.getElementById("closeReminderSettingsBtn")?.addEventListener("click", () => this.close());
    document.getElementById("reminderSettingsDoneBtn")?.addEventListener("click", () => this.close());
    document.getElementById("reminderSettingsOverlay")?.addEventListener("click", (e) => {
      if (e.target.id === "reminderSettingsOverlay") this.close();
    });
    document.getElementById("reminderTurnOnBtn")?.addEventListener("click", async () => {
      await Reminders.request();
      this.render();
    });
    document.getElementById("dailyEmailToggle")?.addEventListener("change", (e) => {
      this.save({ dailyEmail: e.target.checked });
      showToast(e.target.checked ? "You'll get your day by email each morning." : "Morning email turned off.", 3000, null, "check");
    });
    document.getElementById("dailyEmailHour")?.addEventListener("change", (e) => {
      this.save({ dailyEmailHour: Number(e.target.value) });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.close();
    });
    document.addEventListener("momentum:reminders-changed", () => this.render());
  }
};
