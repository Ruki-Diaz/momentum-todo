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
Motion.bindSpotlight();

// Initialize Ambient WebGL Canvas
const ambientCanvas = new AmbientCanvas("ambientCanvas");
