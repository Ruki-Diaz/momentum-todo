/**
 * Momentum — Stat cards, profile menu, auth (Clerk), onboarding, account, privacy, feedback, import.
 * Classic script: shares global scope with the other files in /js, loaded in order by index.html.
 */

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
      showToast(`${streak}-day completion streak! Keep up the momentum.`, 3500, null, "flame");
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
    this.endBoot();
    const appShellEl = document.getElementById("appShell");
    if (appShellEl) {
      appShellEl.classList.remove("app-shell-visible");
      appShellEl.hidden = true;
    }
    if (typeof LandingPage !== "undefined") {
      LandingPage.show();
    }
  },

  showAppShell({ booting = false } = {}) {
    if (typeof LandingPage !== "undefined") {
      LandingPage.hide();
    }
    const appShellEl = document.getElementById("appShell");
    if (appShellEl) {
      const wasHidden = appShellEl.hidden;
      appShellEl.classList.add("app-shell-visible");
      appShellEl.hidden = false;
      if (wasHidden) {
        // The sidebar is an off-canvas drawer on mobile, so only choreograph it on desktop.
        const sidebarSel = window.matchMedia("(min-width: 768px)").matches ? ".app-sidebar, " : "";
        Motion.reveal(appShellEl.querySelectorAll(`${sidebarSel}.hero-section, .stats-grid > *, .composer-panel, .controls-panel, .list-panel, .workspace-secondary > .rail-card`));
      }
    }
    if (booting) {
      this.startBoot();
    } else {
      this.endBoot();
    }
  },

  /**
   * First paint before auth resolves. Picks the most likely screen from what the
   * browser already knows, so visitors never stare at a blank page while ClerkJS
   * downloads. init() still makes the authoritative decision and corrects it.
   */
  paintBootHint() {
    const intent = localStorage.getItem("momentum-workspace-intent");
    // Clerk sets __client_uat to a non-zero timestamp while a session exists.
    const hasSessionHint = /(?:^|;\s*)__client_uat(?:_[^=]*)?=(?!0(?:;|$))\d+/.test(document.cookie);
    if (hasSessionHint) {
      this.showAppShell({ booting: true });
    } else if (intent === "local") {
      this.showAppShell();
    } else {
      this.showLanding();
    }
  },

  startBoot() {
    const appShellEl = document.getElementById("appShell");
    state.booting = true;
    // Don't flash local-mode data under what is probably a cloud session.
    // switchToCloud / switchToLocal both reload todos & projects when boot ends.
    state.todos = [];
    state.projects = [];
    if (appShellEl) {
      appShellEl.classList.add("app-booting");
      appShellEl.inert = true;
      appShellEl.setAttribute("aria-busy", "true");
    }
    render();
  },

  endBoot() {
    if (!state.booting) return;
    state.booting = false;
    const appShellEl = document.getElementById("appShell");
    if (appShellEl) {
      appShellEl.classList.remove("app-booting");
      appShellEl.inert = false;
      appShellEl.removeAttribute("aria-busy");
    }
    render();
  },

  async init() {
    this.setupListeners();
    this.paintBootHint();

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
        // Stay in the skeleton boot state until the cloud workspace starts loading.
        this.showAppShell({ booting: state.booting });
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

      // Switch to Cloud Workspace. endBoot() and switchToCloud() run in the same
      // task, so the skeleton hands straight over to the cloud loading state.
      this.endBoot();
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
