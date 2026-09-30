/**
 * Momentum — Ambient WebGL atmosphere for the dashboard.
 * Classic script: shares global scope with the other files in /js, loaded in order by index.html.
 */

// ==========================================================================
// 27. LIGHTWEIGHT NATIVE WEBGL ATMOSPHERIC SHADER ENGINE
// ==========================================================================
class AmbientCanvas {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;

    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.gl = this.canvas.getContext("webgl", { alpha: true, powerPreference: "low-power" });
    if (!this.gl) {
      console.warn("WebGL not supported; defaulting to CSS atmosphere.");
      return;
    }

    this.mouse = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 };
    this.time = 0;
    this.isRunning = false;
    this.animationFrameId = null;

    this.init();
  }

  init() {
    const gl = this.gl;

    const vsSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        v_uv = (a_position + 1.0) * 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fsSource = `
      precision mediump float;
      uniform vec2 u_resolution;
      uniform vec2 u_mouse;
      uniform float u_time;
      uniform float u_is_dark;
      varying vec2 v_uv;

      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution;
        vec2 mouse = u_mouse;

        float t = u_time * 0.12;
        
        vec2 p1 = vec2(0.25 + 0.15 * sin(t * 0.6), 0.75 + 0.15 * cos(t * 0.5));
        p1 += (mouse - 0.5) * 0.08;
        float d1 = length(uv - p1);
        float w1 = smoothstep(0.85, 0.0, d1);

        vec2 p2 = vec2(0.8 + 0.12 * cos(t * 0.7), 0.25 + 0.12 * sin(t * 0.4));
        p2 += (mouse - 0.5) * 0.06;
        float d2 = length(uv - p2);
        float w2 = smoothstep(0.75, 0.0, d2);

        vec2 p3 = vec2(0.5 + 0.2 * sin(t * 0.3), 0.5 + 0.15 * cos(t * 0.4));
        float d3 = length(uv - p3);
        float w3 = smoothstep(0.9, 0.0, d3);

        vec3 darkBase = vec3(0.07, 0.06, 0.055);
        vec3 darkOrange = vec3(0.94, 0.51, 0.32);
        vec3 darkAmber = vec3(0.84, 0.64, 0.29);
        vec3 darkGreen = vec3(0.31, 0.62, 0.46);

        vec3 lightBase = vec3(0.96, 0.94, 0.91);
        vec3 lightOrange = vec3(0.85, 0.42, 0.25);
        vec3 lightAmber = vec3(0.72, 0.47, 0.14);
        vec3 lightGreen = vec3(0.18, 0.49, 0.35);

        vec3 base = mix(lightBase, darkBase, u_is_dark);
        vec3 cOrange = mix(lightOrange, darkOrange, u_is_dark);
        vec3 cAmber = mix(lightAmber, darkAmber, u_is_dark);
        vec3 cGreen = mix(lightGreen, darkGreen, u_is_dark);

        vec3 col = base;
        col += cOrange * (w1 * (u_is_dark > 0.5 ? 0.28 : 0.14));
        col += cGreen * (w2 * (u_is_dark > 0.5 ? 0.18 : 0.08));
        col += cAmber * (w3 * (u_is_dark > 0.5 ? 0.14 : 0.06));

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const program = this.createProgram(gl, vsSource, fsSource);
    if (!program) return;
    this.program = program;

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const positionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    this.uResolution = gl.getUniformLocation(program, "u_resolution");
    this.uMouse = gl.getUniformLocation(program, "u_mouse");
    this.uTime = gl.getUniformLocation(program, "u_time");
    this.uIsDark = gl.getUniformLocation(program, "u_is_dark");

    this.resize();
    window.addEventListener("resize", () => this.resize());

    window.addEventListener("mousemove", (e) => {
      this.mouse.targetX = e.clientX / window.innerWidth;
      this.mouse.targetY = 1.0 - e.clientY / window.innerHeight;
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.stop();
      } else if (!this.reducedMotion) {
        this.start();
      }
    });

    if (this.reducedMotion) {
      this.renderStatic();
    } else {
      this.start();
    }
  }

  createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  createProgram(gl, vsSource, fsSource) {
    const vs = this.createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = this.createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn(gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  resize() {
    if (!this.canvas || !this.gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.floor(window.innerWidth * dpr);
    const height = Math.floor(window.innerHeight * dpr);

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    let lastTime = performance.now();

    const loop = (currentTime) => {
      if (!this.isRunning) return;
      const delta = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      this.time += delta;
      this.mouse.x += (this.mouse.targetX - this.mouse.x) * 0.04;
      this.mouse.y += (this.mouse.targetY - this.mouse.y) * 0.04;

      this.draw();
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

  renderStatic() {
    this.time = 1.0;
    this.draw();
  }

  draw() {
    const gl = this.gl;
    if (!gl || !this.program) return;

    gl.useProgram(this.program);
    gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uMouse, this.mouse.x, this.mouse.y);
    gl.uniform1f(this.uTime, this.time);

    const isDark = document.documentElement.getAttribute("data-theme") === "dark" ? 1.0 : 0.0;
    gl.uniform1f(this.uIsDark, isDark);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
