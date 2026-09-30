/**
 * Momentum — Motion engine (Web Animations API, zero dependencies).
 * Classic script: shares global scope with the other files in /js, loaded in order by index.html.
 *
 * Rules (from the UI/UX Pro Max motion guidelines):
 *  - Animate transform/opacity only, so everything stays on the compositor.
 *  - Enter with a decelerating spring curve; exits run ~65% of enter duration.
 *  - Stagger list entrances 35ms/item, capped so long lists never feel sluggish.
 *  - Every animation is skipped (final state rendered instantly) under
 *    prefers-reduced-motion, and all animations are interruptible.
 */

const Motion = (() => {
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const EASE_SPRING = "cubic-bezier(0.22, 1.2, 0.36, 1)"; // slight overshoot, settles fast
  const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
  const EASE_IN = "cubic-bezier(0.4, 0, 1, 1)";
  const DUR = { fast: 160, base: 280, slow: 420 };
  const STAGGER_MS = 35;
  const STAGGER_CAP = 10;

  const counterFrames = new WeakMap();

  function reduced() {
    return reducedQuery.matches;
  }

  function animate(el, keyframes, options) {
    if (!el || reduced() || typeof el.animate !== "function") return null;
    return el.animate(keyframes, { fill: "backwards", ...options });
  }

  /** Snapshot positions of keyed children (data-id) before a re-render. */
  function captureList(listEl) {
    const rects = new Map();
    if (!listEl) return rects;
    listEl.querySelectorAll(":scope > [data-id]").forEach((el) => {
      rects.set(el.dataset.id, el.getBoundingClientRect());
    });
    return rects;
  }

  /**
   * After a re-render: items that existed glide from their old spot (FLIP);
   * new items rise in. `stagger` is used for view changes / first paint.
   */
  function playList(listEl, prevRects, { stagger = false } = {}) {
    if (!listEl || reduced()) return;
    let enterIndex = 0;
    listEl.querySelectorAll(":scope > *").forEach((el) => {
      const id = el.dataset.id;
      const prev = id ? prevRects.get(id) : null;

      if (prev && !stagger) {
        const next = el.getBoundingClientRect();
        const dy = prev.top - next.top;
        if (Math.abs(dy) > 1) {
          animate(el, [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], {
            duration: DUR.base + 60,
            easing: EASE_SPRING
          });
        }
        return;
      }

      const delay = stagger ? Math.min(enterIndex, STAGGER_CAP) * STAGGER_MS : 0;
      enterIndex++;
      animate(
        el,
        [
          { opacity: 0, transform: "translateY(12px) scale(0.985)" },
          { opacity: 1, transform: "translateY(0) scale(1)" }
        ],
        { duration: DUR.slow, delay, easing: EASE_SPRING }
      );
    });
  }

  /** Fade-and-rise for a group of blocks (used on view switches and boot). */
  function reveal(elements, { stagger = STAGGER_MS * 1.5, distance = 10 } = {}) {
    Array.from(elements)
      .filter(Boolean)
      .forEach((el, i) => {
        animate(
          el,
          [
            { opacity: 0, transform: `translateY(${distance}px)` },
            { opacity: 1, transform: "translateY(0)" }
          ],
          { duration: DUR.slow + 80, delay: i * stagger, easing: EASE_OUT }
        );
      });
  }

  /** Animates a numeric text node from its current value to `value`. */
  function setCount(el, value) {
    if (!el) return;
    const target = Number(value) || 0;
    const from = Number.parseInt(el.textContent, 10);
    if (reduced() || !Number.isFinite(from) || from === target || !el.isConnected) {
      el.textContent = String(target);
      return;
    }
    cancelAnimationFrame(counterFrames.get(el));
    const start = performance.now();
    const duration = Math.min(700, 220 + Math.abs(target - from) * 40);
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(from + (target - from) * eased));
      if (t < 1) counterFrames.set(el, requestAnimationFrame(step));
    };
    counterFrames.set(el, requestAnimationFrame(step));
    // A gentle pulse tells the eye which number moved.
    animate(el, [{ transform: "scale(1)" }, { transform: "scale(1.14)" }, { transform: "scale(1)" }], {
      duration: DUR.slow,
      easing: EASE_SPRING
    });
  }

  /** Small radial burst from a checkbox when a task is completed. */
  function celebrate(anchorEl) {
    if (!anchorEl || reduced()) return;
    const rect = anchorEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const layer = document.createElement("div");
    layer.className = "motion-burst";
    layer.setAttribute("aria-hidden", "true");
    layer.style.left = `${cx}px`;
    layer.style.top = `${cy}px`;
    document.body.appendChild(layer);

    const colors = ["var(--success)", "var(--accent)", "var(--warning)"];
    const count = 10;
    const animations = [];
    for (let i = 0; i < count; i++) {
      const p = document.createElement("span");
      p.className = "motion-burst-particle";
      p.style.background = colors[i % colors.length];
      layer.appendChild(p);
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const dist = 22 + Math.random() * 16;
      const x = Math.cos(angle) * dist;
      const y = Math.sin(angle) * dist;
      animations.push(
        p.animate(
          [
            { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
            { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(0.2)`, opacity: 0 }
          ],
          { duration: 520 + Math.random() * 160, easing: EASE_OUT, fill: "forwards" }
        ).finished
      );
    }
    const ring = document.createElement("span");
    ring.className = "motion-burst-ring";
    layer.appendChild(ring);
    animations.push(
      ring.animate(
        [
          { transform: "translate(-50%, -50%) scale(0.6)", opacity: 0.7 },
          { transform: "translate(-50%, -50%) scale(2.4)", opacity: 0 }
        ],
        { duration: 480, easing: EASE_OUT, fill: "forwards" }
      ).finished
    );
    Promise.allSettled(animations).then(() => layer.remove());
  }

  /** Exit animation; resolves when done (instantly under reduced motion). */
  function exit(el, { distance = 8 } = {}) {
    const anim = animate(
      el,
      [
        { opacity: 1, transform: "translateY(0) scale(1)" },
        { opacity: 0, transform: `translateY(${distance}px) scale(0.98)` }
      ],
      { duration: Math.round(DUR.base * 0.65), easing: EASE_IN, fill: "forwards" }
    );
    return anim ? anim.finished.catch(() => {}) : Promise.resolve();
  }

  /** Pointer-follow glow for elements with the .motion-spotlight class. */
  function bindSpotlight(root = document) {
    if (window.matchMedia("(hover: none)").matches) return;
    root.addEventListener(
      "pointermove",
      (e) => {
        const target = e.target instanceof Element ? e.target.closest(".motion-spotlight") : null;
        if (!target) return;
        const r = target.getBoundingClientRect();
        target.style.setProperty("--spot-x", `${e.clientX - r.left}px`);
        target.style.setProperty("--spot-y", `${e.clientY - r.top}px`);
      },
      { passive: true }
    );
  }

  return { reduced, animate, captureList, playList, reveal, setCount, celebrate, exit, bindSpotlight, DUR, EASE_SPRING, EASE_OUT };
})();
