/**
 * Momentum — Landing Page Presentation Controller
 * Stage 5C.1: Premium Landing Experience
 *
 * ARCHITECTURAL CONTRACT:
 * - This file owns ONLY presentation: WebGL, animations, scroll, pointer effects.
 * - All routing decisions (landing / local / cloud) are made by AuthManager in app.js.
 * - LandingPage exposes a clean API; it never calls AuthManager or WorkspaceRepository.
 * - CTA button hooks are registered by AuthManager after init via registerCTAHandlers().
 *
 * Public API:
 *   LandingPage.show()                  — make landing visible, restart effects
 *   LandingPage.hide()                  — hide landing, pause/destroy effects
 *   LandingPage.destroy()               — full cleanup (RAF, observers, listeners)
 *   LandingPage.registerCTAHandlers(h)  — wire CTA buttons to AuthManager callbacks
 *   LandingPage.initNavScrolled()       — setup scroll-spy for nav
 */

"use strict";

// ==========================================================================
// 1. LANDING WEBGL CANVAS — Cinematic ambient atmosphere
// ==========================================================================
class LandingCanvasEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.gl = null;
    this.program = null;
    this.uResolution = null;
    this.uMouse = null;
    this.uTime = null;
    this.mouse = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 };
    this.time = 0;
    this.isRunning = false;
    this.animationFrameId = null;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this._onMouseMove = null;
    this._onVisibility = null;
    this._onResize = null;

    if (!this.canvas) return;
    this._initWebGL();
  }

  _initWebGL() {
    const gl = this.canvas.getContext("webgl", { alpha: true, powerPreference: "low-power" });
    if (!gl) {
      // CSS fallback is already in place via landing.css background property
      return;
    }
    this.gl = gl;

    const vsSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        v_uv = (a_position + 1.0) * 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    // Enhanced landing shader — 5 light sources, richer noise, vignette, cinematic depth
    const fsSource = `
      precision mediump float;
      uniform vec2  u_resolution;
      uniform vec2  u_mouse;
      uniform float u_time;
      varying vec2  v_uv;

      // Smooth hash for organic noise feel
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      void main() {
        vec2 uv    = gl_FragCoord.xy / u_resolution;
        vec2 mouse = u_mouse;

        float t = u_time * 0.055; // Slower, more cinematic than dashboard

        // Five organic light sources — drifting slowly
        vec2 p1 = vec2(0.18 + 0.14 * sin(t * 0.7), 0.78 + 0.12 * cos(t * 0.5));
        p1 += (mouse - 0.5) * 0.14;
        float d1 = length(uv - p1);
        float w1 = smoothstep(0.90, 0.0, d1);

        vec2 p2 = vec2(0.82 + 0.10 * cos(t * 0.6), 0.22 + 0.12 * sin(t * 0.45));
        p2 += (mouse - 0.5) * 0.10;
        float d2 = length(uv - p2);
        float w2 = smoothstep(0.80, 0.0, d2);

        vec2 p3 = vec2(0.50 + 0.20 * sin(t * 0.35), 0.50 + 0.18 * cos(t * 0.40));
        p3 += (mouse - 0.5) * 0.06;
        float d3 = length(uv - p3);
        float w3 = smoothstep(0.95, 0.0, d3);

        vec2 p4 = vec2(0.70 + 0.10 * cos(t * 0.55), 0.70 + 0.10 * sin(t * 0.65));
        float d4 = length(uv - p4);
        float w4 = smoothstep(0.65, 0.0, d4);

        vec2 p5 = vec2(0.28 + 0.12 * sin(t * 0.50), 0.35 + 0.10 * cos(t * 0.80));
        float d5 = length(uv - p5);
        float w5 = smoothstep(0.60, 0.0, d5);

        // Organic noise layer for smoke/silk texture
        float n = noise(uv * 3.5 + t * 0.4) * 0.5 + noise(uv * 7.0 + t * 0.3) * 0.25;

        // Deep espresso dark base — Momentum landing palette
        vec3 base   = vec3(0.050, 0.043, 0.035);
        vec3 cOrange = vec3(0.94, 0.51, 0.32);  // #f08352
        vec3 cAmber  = vec3(0.84, 0.64, 0.29);  // #d7a34b
        vec3 cGreen  = vec3(0.31, 0.62, 0.46);  // #4e9d75

        vec3 col = base;
        col += cOrange * w1 * 0.32;       // main hero warm light
        col += cGreen  * w2 * 0.20;       // lower right cool accent
        col += cAmber  * w3 * 0.15;       // center warmth
        col += cOrange * w4 * 0.10;       // upper right subtle
        col += cGreen  * w5 * 0.10;       // left mid subtle

        // Noise overlay for organic silk texture
        col += (cOrange * n * 0.06);

        // Radial center-depth gradient — focus hero text area
        float hero_dist = length(uv - vec2(0.28, 0.5));
        float hero_glow = smoothstep(0.7, 0.0, hero_dist) * 0.08;
        col += vec3(0.18, 0.14, 0.10) * hero_glow;

        // Vignette — darkens corners for cinematic feel
        float vignette = 1.0 - smoothstep(0.35, 1.0, length(uv - 0.5) * 1.5);
        col *= vignette;

        // Clamp to prevent blowout
        col = min(col, vec3(1.0));

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const program = this._createProgram(gl, vsSource, fsSource);
    if (!program) return;
    this.program = program;

    const positions = new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    this.uResolution = gl.getUniformLocation(program, "u_resolution");
    this.uMouse      = gl.getUniformLocation(program, "u_mouse");
    this.uTime       = gl.getUniformLocation(program, "u_time");

    this._resize();

    this._onResize = () => this._resize();
    this._onMouseMove = (e) => {
      this.mouse.targetX = e.clientX / window.innerWidth;
      this.mouse.targetY = 1.0 - e.clientY / window.innerHeight;
    };
    this._onVisibility = () => {
      if (document.hidden) {
        this.stop();
      } else if (this.isRunning === false && !this.reducedMotion) {
        // Only restart if we were running before
        this.start();
      }
    };

    window.addEventListener("resize", this._onResize);
    window.addEventListener("mousemove", this._onMouseMove);
    document.addEventListener("visibilitychange", this._onVisibility);

    if (this.reducedMotion) {
      this._drawStatic();
    } else {
      this.start();
    }
  }

  _createShader(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("[LandingCanvas] Shader compile error:", gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  _createProgram(gl, vs, fs) {
    const vShader = this._createShader(gl, gl.VERTEX_SHADER, vs);
    const fShader = this._createShader(gl, gl.FRAGMENT_SHADER, fs);
    if (!vShader || !fShader) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vShader);
    gl.attachShader(prog, fShader);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("[LandingCanvas] Program link error:", gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }

  _resize() {
    if (!this.canvas || !this.gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
  }

  _draw() {
    const gl = this.gl;
    if (!gl || !this.program) return;
    gl.useProgram(this.program);
    gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uMouse, this.mouse.x, this.mouse.y);
    gl.uniform1f(this.uTime, this.time);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  _drawStatic() {
    this.time = 1.0;
    this._draw();
  }

  start() {
    if (this.isRunning || !this.gl) return;
    this.isRunning = true;
    let lastTime = performance.now();
    const loop = (now) => {
      if (!this.isRunning) return;
      const delta = (now - lastTime) / 1000;
      lastTime = now;
      this.time += delta;
      // Smooth mouse lerp — more languid than dashboard
      this.mouse.x += (this.mouse.targetX - this.mouse.x) * 0.025;
      this.mouse.y += (this.mouse.targetY - this.mouse.y) * 0.025;
      this._draw();
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  destroy() {
    this.stop();
    if (this._onResize)     window.removeEventListener("resize", this._onResize);
    if (this._onMouseMove)  window.removeEventListener("mousemove", this._onMouseMove);
    if (this._onVisibility) document.removeEventListener("visibilitychange", this._onVisibility);
    this._onResize = null;
    this._onMouseMove = null;
    this._onVisibility = null;
    // Release GL resources
    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
    }
    this.gl = null;
    this.program = null;
  }
}

// ==========================================================================
// 2. LANDING PAGE CONTROLLER — Pure presentation, no routing logic
// ==========================================================================
const LandingPage = (function () {
  let _canvas = null;         // LandingCanvasEngine instance
  let _observers = [];        // IntersectionObservers to disconnect on destroy
  let _ctaHandlers = null;    // Registered CTA callbacks from AuthManager
  let _isVisible = false;
  let _navScrollListener = null;

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  function _setupScrollReveal() {
    const revealEls = document.querySelectorAll(
      ".landing-hero-eyebrow, .landing-hero-headline, .landing-hero-sub, " +
      ".landing-hero-actions, .landing-local-mode-link, .landing-hero-preview, " +
      ".landing-section-tag, .landing-section-heading, .landing-section-body, " +
      ".landing-section-visual, .landing-cta-headline, .landing-cta-sub, " +
      ".landing-cta-actions"
    );

    if (!revealEls.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("revealed");
            observer.unobserve(entry.target); // Reveal once only
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    revealEls.forEach((el) => observer.observe(el));
    _observers.push(observer);
  }

  function _setupNav() {
    const nav = document.querySelector(".landing-nav");
    if (!nav) return;

    if (_navScrollListener) {
      window.removeEventListener("scroll", _navScrollListener);
    }

    _navScrollListener = () => {
      if (window.scrollY > 48) {
        nav.classList.add("scrolled");
      } else {
        nav.classList.remove("scrolled");
      }
    };

    window.addEventListener("scroll", _navScrollListener, { passive: true });
    _navScrollListener(); // run once on show
  }

  function _teardownNav() {
    if (_navScrollListener) {
      window.removeEventListener("scroll", _navScrollListener);
      _navScrollListener = null;
    }
    const nav = document.querySelector(".landing-nav");
    if (nav) nav.classList.remove("scrolled");
  }

  function _setupCTAButtons() {
    // Smooth-scroll "Explore" links
    const exploreBtn = document.getElementById("landingExploreBtn");
    if (exploreBtn) {
      exploreBtn.onclick = (e) => {
        e.preventDefault();
        const firstSection = document.querySelector(".landing-sections");
        if (firstSection) {
          firstSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      };
    }

    // "Get Started" buttons — delegate to AuthManager via registered handler
    ["landingHeroGetStartedBtn", "landingNavGetStartedBtn", "landingCtaGetStartedBtn"].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.onclick = (e) => {
          e.preventDefault();
          if (_ctaHandlers && _ctaHandlers.onGetStarted) {
            _ctaHandlers.onGetStarted();
          }
        };
      }
    });

    // "Sign In" nav link
    const navSignInBtn = document.getElementById("landingNavSignInBtn");
    if (navSignInBtn) {
      navSignInBtn.onclick = (e) => {
        e.preventDefault();
        if (_ctaHandlers && _ctaHandlers.onSignIn) {
          _ctaHandlers.onSignIn();
        }
      };
    }

    // "Continue in Local Mode" links — delegates to AuthManager
    ["landingLocalModeBtn", "landingCtaLocalBtn"].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.onclick = (e) => {
          e.preventDefault();
          if (_ctaHandlers && _ctaHandlers.onContinueLocal) {
            _ctaHandlers.onContinueLocal();
          }
        };
      }
    });
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Register CTA button callbacks from AuthManager.
   * Must be called once during AuthManager.init().
   */
  function registerCTAHandlers(handlers) {
    // handlers: { onGetStarted, onSignIn, onContinueLocal }
    _ctaHandlers = handlers;
    _setupCTAButtons();
  }

  /**
   * Show the landing page and start all visual effects.
   * Assumes #landingPage and #landingCanvas are in the DOM.
   */
  function show() {
    const page = document.getElementById("landingPage");
    const canvasEl = document.getElementById("landingCanvas");

    if (page) page.classList.remove("landing-hidden");
    if (canvasEl) canvasEl.classList.remove("landing-canvas-hidden");

    _isVisible = true;

    // Start/restart WebGL canvas
    if (!_canvas) {
      _canvas = new LandingCanvasEngine("landingCanvas");
    } else {
      _canvas.start();
    }

    // Setup scroll / reveal effects & CTA hooks
    _setupCTAButtons();
    _setupNav();
    _setupScrollReveal();
  }

  /**
   * Hide the landing page and pause visual effects.
   * The dashboard is about to take over.
   */
  function hide() {
    const page = document.getElementById("landingPage");
    const canvasEl = document.getElementById("landingCanvas");

    if (page) page.classList.add("landing-hidden");
    if (canvasEl) canvasEl.classList.add("landing-canvas-hidden");

    _isVisible = false;

    // Pause WebGL — don't destroy; sign-out may show landing again
    if (_canvas) _canvas.stop();

    _teardownNav();
  }

  /**
   * Full cleanup: destroy WebGL context, disconnect all observers,
   * remove all event listeners. Call when permanently leaving landing.
   */
  function destroy() {
    hide();

    if (_canvas) {
      _canvas.destroy();
      _canvas = null;
    }

    _observers.forEach((obs) => obs.disconnect());
    _observers = [];

    _teardownNav();
  }

  /**
   * Expose whether landing is currently visible.
   */
  function isVisible() {
    return _isVisible;
  }

  return {
    show,
    hide,
    destroy,
    isVisible,
    registerCTAHandlers
  };
})();

// Make globally accessible — AuthManager in app.js will use it
window.LandingPage = LandingPage;
