/**
 * Momentum — Boot sequence. Must load last.
 * Classic script: shares global scope with the other files in /js, loaded in order by index.html.
 */

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
Reminders.setupListeners();
FilterSheet.setupListeners();
InstallHelper.setupListeners();
SaveNudge.setupListeners();
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
  showToast("You're back online.", 3000);
});
window.addEventListener("offline", () => {
  showToast(
    WorkspaceRepository.isCloud()
      ? "You're offline. Changes may not save until you're back online."
      : "You're offline. Your tasks are still saved on this device.",
    3500
  );
});

// Check reminders every 30 seconds (and when the tab becomes visible; see reminders.js)
setInterval(checkReminders, 30000);
checkReminders();

if (state.currentView === "today") {
  dueDateInput.value = getLocalDateString();
  mobileDueDateInput.value = getLocalDateString();
}

render();
Motion.bindSpotlight();

// Initialize Ambient WebGL Canvas
const ambientCanvas = new AmbientCanvas("ambientCanvas");
