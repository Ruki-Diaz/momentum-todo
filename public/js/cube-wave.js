/**
 * Momentum — Cube Wave (landing page visual).
 * A grid of instanced cubes riding a radial wave from the center outward,
 * blending from deep copper in the troughs to warm amber on the crests.
 *
 * Native WebGL2, zero dependencies, one draw call. The wave is computed in the
 * vertex shader, so each frame is a single uniform update.
 *  - Renders only while on screen (and rAF itself pauses in background tabs).
 *  - prefers-reduced-motion: draws one still frame.
 *  - No WebGL2: the canvas stays empty and the CSS gradient fallback shows.
 *
 * Usage: <canvas data-cube-wave></canvas> (auto-initialised on load).
 */

(function () {
  const VERT = `#version 300 es
    in vec3 aPos;
    in vec3 aNormal;
    in vec2 aCell;
    uniform mat4 uViewProj;
    uniform float uTime;
    uniform float uGap;
    out vec3 vNormal;
    out vec3 vWorld;
    out float vK;
    out float vDist;
    void main() {
      float d = length(aCell);
      float y = sin(d * 0.9 - uTime * 2.1) * 0.45;
      vec3 world = aPos * 0.62 + vec3(aCell.x * uGap, y, aCell.y * uGap);
      vK = (y + 0.45) / 0.9;
      vDist = d;
      vNormal = aNormal;
      vWorld = world;
      gl_Position = uViewProj * vec4(world, 1.0);
    }`;

  const FRAG = `#version 300 es
    precision highp float;
    in vec3 vNormal;
    in vec3 vWorld;
    in float vK;
    in float vDist;
    uniform vec3 uTrough;
    uniform vec3 uCrest;
    uniform vec3 uCamPos;
    uniform float uMaxDist;
    out vec4 outColor;
    void main() {
      vec3 n = normalize(vNormal);
      vec3 L = normalize(vec3(0.45, 1.0, 0.3));
      vec3 V = normalize(uCamPos - vWorld);
      vec3 H = normalize(L + V);
      float diff = max(dot(n, L), 0.0);
      float spec = pow(max(dot(n, H), 0.0), 36.0) * 0.4;
      float k = smoothstep(0.0, 1.0, vK);
      vec3 base = mix(uTrough, uCrest, k);
      vec3 col = base * (0.22 + 0.9 * diff) + spec * vec3(1.0, 0.88, 0.76) + uCrest * k * k * 0.22;
      // Fade the outer ring so the grid dissolves into the card instead of ending in a hard edge.
      float fade = 1.0 - smoothstep(uMaxDist * 0.5, uMaxDist, vDist);
      outColor = vec4(col * fade, fade);
    }`;

  // Unit cube, 36 non-indexed vertices: position (xyz) + normal (xyz).
  function cubeVertices() {
    const faces = [
      [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
      [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
      [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
      [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
      [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
      [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]]
    ];
    const out = [];
    for (const [n, q] of faces) {
      for (const idx of [0, 1, 2, 0, 2, 3]) {
        const p = q[idx];
        out.push(p[0] * 0.5, p[1] * 0.5, p[2] * 0.5, n[0], n[1], n[2]);
      }
    }
    return new Float32Array(out);
  }

  function perspective(fovDeg, aspect, near, far) {
    const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
    const nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }

  function lookAt(eye, target, up) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const norm = (v) => {
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const z = norm(sub(eye, target));
    const x = norm(cross(up, z));
    const y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  }

  function multiply(a, b) {
    const out = new Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] =
          a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return out;
  }

  function hexToRgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }

  function compile(gl, type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("[CubeWave] shader error:", gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  }

  class CubeWave {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.speed = options.speed ?? 0.9;
      this.gap = options.gap ?? 0.75;
      this.camera = options.camera ?? [8, 7, 8];
      // Extra pull-back so the whole wave (and its faded rim) sits inside a card-sized canvas.
      this.distance = options.distance ?? 1.38;
      this.fov = options.fov ?? 32;
      this.trough = hexToRgb(options.trough ?? "#6e2c14");
      this.crest = hexToRgb(options.crest ?? "#f3a55e");
      this.reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.visible = false;
      this.frame = 0;
      this.startTime = performance.now();

      const gl = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true });
      if (!gl) return;
      this.gl = gl;
      if (!this._initProgram()) return;
      this._buildGrid();
      this._observe();
      this.ready = true;
      canvas.classList.add("is-ready");
    }

    _initProgram() {
      const gl = this.gl;
      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return false;
      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
      this.program = program;
      this.u = {};
      for (const name of ["uViewProj", "uTime", "uGap", "uTrough", "uCrest", "uCamPos", "uMaxDist"]) {
        this.u[name] = gl.getUniformLocation(program, name);
      }

      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      const cube = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, cube);
      gl.bufferData(gl.ARRAY_BUFFER, cubeVertices(), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(program, "aPos");
      const aNormal = gl.getAttribLocation(program, "aNormal");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(aNormal);
      gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 24, 12);

      this.cellBuffer = gl.createBuffer();
      const aCell = gl.getAttribLocation(program, "aCell");
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cellBuffer);
      gl.enableVertexAttribArray(aCell);
      gl.vertexAttribPointer(aCell, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(aCell, 1);
      gl.bindVertexArray(null);

      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      return true;
    }

    /** Grid density adapts to the canvas width (fewer cubes on phones). */
    _buildGrid() {
      const width = this.canvas.clientWidth || 600;
      const grid = width < 420 ? 12 : width < 700 ? 14 : 16;
      if (grid === this.grid) return;
      this.grid = grid;
      const half = (grid - 1) / 2;
      const cells = new Float32Array(grid * grid * 2);
      let i = 0;
      for (let x = 0; x < grid; x++) {
        for (let z = 0; z < grid; z++) {
          cells[i++] = x - half;
          cells[i++] = z - half;
        }
      }
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cellBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, cells, gl.STATIC_DRAW);
      this.count = grid * grid;
      this.maxDist = Math.hypot(half, half) * 0.92;
    }

    _resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this._buildGrid();
      const aspect = w / h;
      // Pull the camera back on narrow canvases so the whole wave stays in frame.
      const pull = aspect < 1 ? Math.min(1 / aspect, 1.6) : 1;
      const eye = this.camera.map((v) => v * this.distance * pull);
      this.eye = eye;
      this.viewProj = multiply(perspective(this.fov, aspect, 0.1, 100), lookAt(eye, [0, -2.6, 0], [0, 1, 0]));
    }

    _draw(timeSec) {
      const gl = this.gl;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.u.uViewProj, false, this.viewProj);
      gl.uniform1f(this.u.uTime, timeSec * this.speed);
      gl.uniform1f(this.u.uGap, this.gap);
      gl.uniform3fv(this.u.uTrough, this.trough);
      gl.uniform3fv(this.u.uCrest, this.crest);
      gl.uniform3fv(this.u.uCamPos, this.eye);
      gl.uniform1f(this.u.uMaxDist, this.maxDist);
      gl.bindVertexArray(this.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, this.count);
      gl.bindVertexArray(null);
    }

    // Browsers already pause rAF in background tabs, so only on-screen visibility is checked here.
    _loop = (now) => {
      this.frame = 0;
      if (!this.visible) return;
      this._draw((now - this.startTime) / 1000);
      if (!this.reducedQuery.matches) this.frame = requestAnimationFrame(this._loop);
    };

    _start() {
      cancelAnimationFrame(this.frame);
      this._resize();
      if (this.reducedQuery.matches) {
        this._draw(1.3); // a pleasing still frame mid-wave
        return;
      }
      this.frame = requestAnimationFrame(this._loop);
    }

    _observe() {
      this.io = new IntersectionObserver(
        ([entry]) => {
          this.visible = entry.isIntersecting;
          if (this.visible) this._start();
          else cancelAnimationFrame(this.frame);
        },
        { rootMargin: "120px" }
      );
      this.io.observe(this.canvas);
      this.ro = new ResizeObserver(() => this.visible && this._start());
      this.ro.observe(this.canvas);
      this.reducedQuery.addEventListener("change", () => this.visible && this._start());
    }
  }

  function init() {
    document.querySelectorAll("canvas[data-cube-wave]").forEach((canvas) => {
      if (!canvas.__cubeWave) canvas.__cubeWave = new CubeWave(canvas);
    });
  }

  window.CubeWave = CubeWave;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
