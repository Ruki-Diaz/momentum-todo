/**
 * Momentum — Phone helpers: the search & filter sheet, "Install Momentum on your phone",
 * and the gentle "Save your tasks" nudge for people without an account.
 * Classic script: shares global scope with the other files in /js, loaded in order by index.html.
 */

// ==========================================================================
// Search & filter sheet (phones ≤ 767px)
// On phones the controls panel is restyled as a bottom sheet (responsive.css), so the
// same filter chips, search, sort and "Clear completed" work everywhere.
// ==========================================================================
const FilterSheet = {
  isPhone() {
    return window.matchMedia("(max-width: 767px)").matches;
  },

  open() {
    if (!controlsPanel) return;
    this._returnFocus = document.activeElement;
    controlsPanel.classList.add("is-open");
    controlsPanel.setAttribute("role", "dialog");
    controlsPanel.setAttribute("aria-modal", "true");
    controlsPanel.setAttribute("aria-label", "Search and filter");
    document.getElementById("filterSheetBackdrop").hidden = false;
    document.getElementById("mobileFilterBtn")?.setAttribute("aria-expanded", "true");
    setTimeout(() => searchInput.focus(), 60);
  },

  close() {
    if (!controlsPanel || !controlsPanel.classList.contains("is-open")) return;
    controlsPanel.classList.remove("is-open");
    controlsPanel.removeAttribute("role");
    controlsPanel.removeAttribute("aria-modal");
    controlsPanel.setAttribute("aria-label", "Task controls and filters");
    document.getElementById("filterSheetBackdrop").hidden = true;
    document.getElementById("mobileFilterBtn")?.setAttribute("aria-expanded", "false");
    if (this._returnFocus && typeof this._returnFocus.focus === "function") this._returnFocus.focus();
  },

  /** Shows a dot on the filter button while a search, filter or sort is in effect. */
  render() {
    const btn = document.getElementById("mobileFilterBtn");
    if (!btn) return;
    const active = state.filter !== "all" || state.search.trim() !== "" || state.sort !== "smart";
    btn.classList.toggle("has-active", active);
    btn.setAttribute("aria-label", active ? "Search and filter (some filters are on)" : "Search and filter");
  },

  setupListeners() {
    document.getElementById("mobileFilterBtn")?.addEventListener("click", () => this.open());
    document.getElementById("closeFilterSheetBtn")?.addEventListener("click", () => this.close());
    document.getElementById("filterSheetBackdrop")?.addEventListener("click", () => this.close());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.close();
      // Keep keyboard focus inside the sheet while it's open.
      if (e.key === "Tab" && controlsPanel.classList.contains("is-open")) {
        const focusables = [...controlsPanel.querySelectorAll("button, input, select")].filter((el) => el.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    window.matchMedia("(max-width: 767px)").addEventListener("change", (e) => {
      if (!e.matches) this.close();
    });
  }
};

// ==========================================================================
// "Install Momentum on your phone"
// Android / desktop Chrome: the browser's own install prompt (beforeinstallprompt).
// iPhone / iPad Safari: a 3-step picture guide. Nothing shows once installed.
// ==========================================================================
let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  InstallHelper.render();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  gsSet(GS_KEYS.installed);
  InstallHelper.render();
  showToast("Momentum is installed. Open it from your Home Screen or app list.", 4000, null, "check");
});

const InstallHelper = {
  isInstalled() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  },

  isIOS() {
    return Reminders.isIOS();
  },

  isPhone() {
    return /android|iphone|ipad|ipod/i.test(navigator.userAgent) || this.isIOS();
  },

  async open() {
    if (this.isInstalled()) return;
    if (userProfileWrap) userProfileWrap.classList.remove("open");

    if (deferredInstallPrompt) {
      const prompt = deferredInstallPrompt;
      deferredInstallPrompt = null;
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice && choice.outcome === "accepted") gsSet(GS_KEYS.installed);
      } catch (err) {
        console.warn("Install prompt failed:", err);
        this.openGuide();
      }
      this.render();
      return;
    }
    this.openGuide();
  },

  openGuide() {
    const overlay = document.getElementById("installGuideOverlay");
    if (!overlay) return;
    // iPhone/iPad: the picture guide. Android without a prompt: menu steps.
    // Computers: how to get it onto a phone, with both sets of steps.
    const mode = this.isIOS() ? "ios" : this.isPhone() ? "android" : "desktop";
    overlay.dataset.mode = mode;
    state.lastFocusedElement = document.activeElement;
    overlay.classList.add("active");
    overlay.setAttribute("aria-hidden", "false");
    setTimeout(() => document.getElementById("closeInstallGuideBtn")?.focus(), 50);
  },

  closeGuide() {
    const overlay = document.getElementById("installGuideOverlay");
    if (!overlay || !overlay.classList.contains("active")) return;
    overlay.classList.remove("active");
    overlay.setAttribute("aria-hidden", "true");
    if (state.lastFocusedElement && typeof state.lastFocusedElement.focus === "function") {
      state.lastFocusedElement.focus();
    }
  },

  render() {
    const menuBtn = document.getElementById("menuInstallBtn");
    if (menuBtn) menuBtn.style.display = this.isInstalled() ? "none" : "flex";
    GettingStarted.render();
  },

  setupListeners() {
    document.getElementById("menuInstallBtn")?.addEventListener("click", () => this.open());
    document.getElementById("closeInstallGuideBtn")?.addEventListener("click", () => this.closeGuide());
    document.getElementById("installGuideDoneBtn")?.addEventListener("click", () => this.closeGuide());
    document.getElementById("installGuideOverlay")?.addEventListener("click", (e) => {
      if (e.target.id === "installGuideOverlay") this.closeGuide();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeGuide();
    });
    const link = document.getElementById("installGuideUrl");
    if (link) link.textContent = window.location.host || "momentumtodo.vercel.app";
    this.render();
  }
};

// ==========================================================================
// "Save your tasks" nudge (no-account mode only)
// After the 3rd task of their own, or after 2 days of use. "Later" hides it for 7 days.
// ==========================================================================
const SAVE_NUDGE_KEYS = { firstUsed: "momentum-first-used", later: "momentum-save-nudge-later" };

const SaveNudge = {
  shouldShow() {
    if (state.booting || WorkspaceRepository.isCloud() || AuthManager.isAuthenticated()) return false;
    const appShellEl = document.getElementById("appShell");
    if (!appShellEl || appShellEl.hidden) return false;

    let firstUsed = Number(gsGet(SAVE_NUDGE_KEYS.firstUsed) || 0);
    if (!firstUsed) {
      firstUsed = Date.now();
      gsSet(SAVE_NUDGE_KEYS.firstUsed, String(firstUsed));
    }
    const later = Number(gsGet(SAVE_NUDGE_KEYS.later) || 0);
    if (later && Date.now() - later < 7 * 24 * 60 * 60 * 1000) return false;

    const ownTasks = state.todos.filter((t) => !(t.tags || []).includes("example")).length;
    const twoDays = Date.now() - firstUsed >= 2 * 24 * 60 * 60 * 1000;
    return ownTasks >= 3 || (twoDays && state.todos.length > 0);
  },

  render() {
    const banner = document.getElementById("saveNudgeBanner");
    if (banner) banner.hidden = !this.shouldShow();
  },

  setupListeners() {
    document.getElementById("saveNudgeCreateBtn")?.addEventListener("click", () => {
      AuthManager.openSignIn({
        reason: "Your tasks will be kept safe in your account, and you can use them on your phone and computer."
      });
    });
    document.getElementById("saveNudgeLaterBtn")?.addEventListener("click", () => {
      gsSet(SAVE_NUDGE_KEYS.later, String(Date.now()));
      this.render();
    });
  }
};
