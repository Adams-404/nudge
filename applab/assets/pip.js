/**
 * Nudge - Pip Character Engine & Web UI Controller
 *
 * Pip is a living liquid blob: a 16-point Bezier spring-physics jelly body
 * with a pure-black mercury silhouette, mood-driven shape morphing, spherical
 * eye depth, blink-masked transitions and procedural accessory FX.
 *
 * On top of the mood engine sits the Design Studio: a persisted, shareable
 * customization layer (silhouette, elasticity, eyes, accessories, colors)
 * so you can redesign your Pip however you like.
 *
 * The Nudge contract is unchanged: same SSE /status stream, same POST
 * /api/poke, /api/decision, /api/chat and pairing flow.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('pip-canvas');
  const ctx = canvas.getContext('2d');
  const halo = document.getElementById('halo-glow');

  const moodBadge = document.getElementById('mood-badge');
  const oneLiner = document.getElementById('one-liner');
  const bridgePill = document.getElementById('bridge-pill');
  const pairPill = document.getElementById('pair-pill');
  const pairStatusText = document.getElementById('pair-status-text');
  const approvalCard = document.getElementById('approval-card');
  const approvalAgent = document.getElementById('approval-agent');
  const approvalSummary = document.getElementById('approval-summary');
  const approvalCommand = document.getElementById('approval-command');
  const btnAllow = document.getElementById('btn-allow');
  const btnDeny = document.getElementById('btn-deny');
  const btnPoke = document.getElementById('btn-poke');
  const btnDemo = document.getElementById('btn-demo');
  const btnToggleChat = document.getElementById('btn-toggle-chat');
  const chatSection = document.getElementById('chat-section');
  const btnCloseChat = document.getElementById('btn-close-chat');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const chatMessages = document.getElementById('chat-messages');
  const pairModal = document.getElementById('pair-modal');
  const btnPairModal = document.getElementById('btn-pair-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnSubmitPair = document.getElementById('btn-submit-pair');
  const btnUnpair = document.getElementById('btn-unpair');
  const pairCodeInput = document.getElementById('pair-code-input');
  const laptopUrlInput = document.getElementById('laptop-url-input');

  // Studio drawer
  const studioDrawer = document.getElementById('studio-drawer');
  const btnStudio = document.getElementById('btn-studio');
  const btnCloseStudio = document.getElementById('btn-close-studio');
  const btnResetStudio = document.getElementById('btn-reset-studio');

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  const LOGICAL_SIZE = 360;
  const NUM_POINTS = 16;
  const BASE_EYE = { w: 22, h: 46, spacing: 52 };
  const STUDIO_KEY = 'nudge.pip.studio.v1';

  // Aura / rim accents per mood (keeps the original Nudge palette DNA).
  const MOOD_THEMES = {
    idle:      { accent: '#38bdf8', rim: '#7dd3fc', aura: [56, 189, 248, 0.16] },
    peek:      { accent: '#60a5fa', rim: '#93c5fd', aura: [96, 165, 250, 0.20] },
    watching:  { accent: '#818cf8', rim: '#a5b4fc', aura: [129, 140, 248, 0.22] },
    needs_you: { accent: '#fbbf24', rim: '#fcd34d', aura: [251, 191, 36, 0.40] },
    happy:     { accent: '#4ade80', rim: '#86efac', aura: [74, 222, 128, 0.28] },
    annoyed:   { accent: '#f87171', rim: '#fca5a5', aura: [248, 113, 113, 0.26] },
    dizzy:     { accent: '#c084fc', rim: '#d8b4fe', aura: [192, 132, 252, 0.30] },
    asleep:    { accent: '#64748b', rim: '#94a3b8', aura: [100, 116, 139, 0.12] }
  };

  const MOOD_EYE_STYLE = {
    idle: 'pill', peek: 'pill', watching: 'pill', needs_you: 'pill',
    happy: 'crescent', annoyed: 'squint', dizzy: 'cross', asleep: 'closed'
  };

  // ---------------------------------------------------------------------------
  // Design Studio configuration
  // ---------------------------------------------------------------------------
  const STUDIO_DEFAULTS = {
    shape: 'AUTO',
    bodyW: 1, bodyH: 1, bodyRot: 0,
    stiffness: 0.13, damping: 0.82,
    eyeStyle: 'AUTO',
    eyeW: BASE_EYE.w, eyeH: BASE_EYE.h, eyeSpacing: BASE_EYE.spacing,
    eyeTilt: 0, eyeY: 0,
    head: 'NONE', aura: 'NONE',
    cheeks: false, rings: false, particles: false,
    bodyColor: '#0a0a0c', eyeColor: '#ffffff'
  };

  let studio = Object.assign({}, STUDIO_DEFAULTS);

  function loadStudio() {
    try {
      const raw = localStorage.getItem(STUDIO_KEY);
      if (raw) studio = Object.assign({}, STUDIO_DEFAULTS, JSON.parse(raw));
    } catch (e) { /* ignore corrupt storage */ }
  }

  function saveStudio() {
    try { localStorage.setItem(STUDIO_KEY, JSON.stringify(studio)); } catch (e) {}
  }

  function resetStudio() {
    studio = Object.assign({}, STUDIO_DEFAULTS);
    saveStudio();
    syncStudioUI();
    triggerBlink();
  }

  // ---------------------------------------------------------------------------
  // Engine state
  // ---------------------------------------------------------------------------
  const state = {
    mood: 'idle',
    activeRequest: null,
    paired: false,

    W: LOGICAL_SIZE,
    H: LOGICAL_SIZE,
    cx: LOGICAL_SIZE / 2,
    cy: LOGICAL_SIZE / 2,
    baseRadius: 92,

    currentRadii: new Float32Array(NUM_POINTS),
    targetRadii: new Float32Array(NUM_POINTS),
    velocities: new Float32Array(NUM_POINTS),

    scaleX: 1, scaleY: 1, rotation: 0, floatY: 0,

    eyeWidth: BASE_EYE.w, eyeHeight: BASE_EYE.h, eyeSpacing: BASE_EYE.spacing,
    eyeTilt: 0, eyeLift: 0,

    mouse: { x: LOGICAL_SIZE / 2, y: LOGICAL_SIZE / 2, over: false },
    eyeOffset: { x: 0, y: 0 },
    targetEyeOffset: { x: 0, y: 0 },

    blinking: false, blinkProgress: 0, nextBlink: Date.now() + 3200,

    time: 0,

    ringVis: 0, sparkleVis: 0,
    orbitVis: 0, dustVis: 0
  };

  // 3D orbital rainbow rings (Blob-Ava inspired) + stardust particles.
  const orbitalRings = [
    { a: 1.34, k: 0.18, tilt: -0.42, speed: 0.022, hue: 0, hueSpan: 160, widthRatio: 0.060, angle: 0 },
    { a: 1.42, k: 0.28, tilt: 0.55, speed: -0.028, hue: 60, hueSpan: 180, widthRatio: 0.052, angle: 1.2 },
    { a: 1.50, k: 0.12, tilt: -0.85, speed: 0.018, hue: 140, hueSpan: 200, widthRatio: 0.066, angle: 2.4 },
    { a: 1.38, k: 0.35, tilt: 0.22, speed: -0.025, hue: 210, hueSpan: 160, widthRatio: 0.055, angle: 3.6 },
    { a: 1.56, k: 0.20, tilt: -0.15, speed: 0.030, hue: 280, hueSpan: 170, widthRatio: 0.058, angle: 4.8 },
    { a: 1.44, k: 0.32, tilt: 0.78, speed: -0.020, hue: 330, hueSpan: 180, widthRatio: 0.048, angle: 5.5 }
  ];

  const particles = [];
  const MAX_PARTICLES = 24;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const theme = () => MOOD_THEMES[state.mood] || MOOD_THEMES.idle;
  const rad = (deg) => (deg * Math.PI) / 180;

  // ---------------------------------------------------------------------------
  // Canvas sizing (crisp on HiDPI)
  // ---------------------------------------------------------------------------
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(LOGICAL_SIZE * dpr);
    canvas.height = Math.round(LOGICAL_SIZE * dpr);
    canvas.style.width = LOGICAL_SIZE + 'px';
    canvas.style.height = LOGICAL_SIZE + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.W = LOGICAL_SIZE;
    state.H = LOGICAL_SIZE;
    state.cx = LOGICAL_SIZE / 2;
    state.cy = LOGICAL_SIZE / 2;
    state.baseRadius = LOGICAL_SIZE * 0.255;
  }

  window.addEventListener('resize', resize);

  // ---------------------------------------------------------------------------
  // Physics setup
  // ---------------------------------------------------------------------------
  function initBlob() {
    for (let i = 0; i < NUM_POINTS; i++) {
      state.currentRadii[i] = state.baseRadius;
      state.targetRadii[i] = state.baseRadius;
      state.velocities[i] = 0;
    }
  }

  function initParticles() {
    particles.length = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      particles.push({
        angle: Math.random() * Math.PI * 2,
        dist: state.baseRadius * (1.25 + Math.random() * 0.7),
        size: 2 + Math.random() * 3.5,
        speed: 0.008 + Math.random() * 0.02,
        alpha: Math.random(),
        yOffset: (Math.random() - 0.5) * 28
      });
    }
  }

  function applyImpulse(amount) {
    for (let i = 0; i < NUM_POINTS; i++) {
      state.velocities[i] += (Math.random() - 0.5) * amount;
    }
  }

  function triggerBlink() {
    state.blinking = true;
    state.blinkProgress = 0;
  }

  // ---------------------------------------------------------------------------
  // Silhouette maths
  // ---------------------------------------------------------------------------
  function moodShapeRadius(mood, a, t) {
    const R = state.baseRadius;
    if (mood === 'annoyed') return R * (1 + 0.12 * Math.cos(a * 4));
    if (mood === 'dizzy') return R * (1 + 0.17 * Math.sin(a * 4 + t * 5));
    if (mood === 'peek') return R * (1 + 0.10 * Math.sin(a));
    if (mood === 'watching') return R * (1 + 0.05 * Math.cos(a * 4));
    return R * (1 + Math.sin(t * 2 + a * 2) * 0.05);
  }

  function studioShapeRadius(shape, a, t) {
    const R = state.baseRadius;
    switch (shape) {
      case 'BLOB':
        return R * (1 + Math.sin(t * 2 + a * 2) * 0.05);
      case 'CLOUD': {
        const bottom = Math.sin(a) > 0.4;
        const puffs = Math.sin(a * 5) * 0.22 + Math.cos(a * 3) * 0.14;
        return R * (bottom ? 0.85 : 1.1 + puffs);
      }
      case 'TRIANGLE':
        return R * (1 + 0.28 * Math.cos(a * 3 + Math.PI / 2));
      case 'EGG':
        return R * (1 + 0.20 * Math.sin(a));
      case 'ROBOT':
        return R * (1 + 0.10 * Math.cos(a * 4));
      case 'CAT': {
        let ear = 0;
        if (Math.abs(a - (-Math.PI / 3)) < 0.34 || Math.abs(a - (-2 * Math.PI / 3)) < 0.34) ear = 0.36;
        return R * (1 + ear);
      }
      case 'RABBIT': {
        let ear = 0;
        if (Math.abs(a - (-Math.PI / 2.3)) < 0.30 || Math.abs(a - (-Math.PI / 1.7)) < 0.30) ear = 0.55;
        return R * (1 + ear);
      }
      case 'PANDA': {
        let ear = 0;
        if (Math.abs(a - (-Math.PI / 3)) < 0.34 || Math.abs(a - (-2 * Math.PI / 3)) < 0.34) ear = 0.30;
        return R * (1 + ear);
      }
      case 'UFO':
        return R * (1 + Math.abs(Math.cos(a)) * 0.7 - Math.abs(Math.sin(a)) * 0.45);
      default:
        return moodShapeRadius(state.mood, a, t);
    }
  }

  function computeShapeRadii(t) {
    const shape = studio.shape;
    for (let i = 0; i < NUM_POINTS; i++) {
      const a = (i / NUM_POINTS) * Math.PI * 2;
      state.targetRadii[i] = shape === 'AUTO'
        ? moodShapeRadius(state.mood, a, t)
        : studioShapeRadius(shape, a, t);
    }
  }

  // ---------------------------------------------------------------------------
  // Mood + studio -> target parameters
  // ---------------------------------------------------------------------------
  function computeMoodParams(mood, t) {
    let sx = 1, sy = 1, rot = 0;
    let eyeW = BASE_EYE.w, eyeH = BASE_EYE.h, spacing = BASE_EYE.spacing, tilt = 0, lift = 0;
    let ring = 0, sparkle = 0;

    switch (mood) {
      case 'idle':
        sx = 1 + Math.sin(t * 1.5) * 0.03;
        sy = 1 - Math.sin(t * 1.5) * 0.03;
        rot = Math.sin(t * 0.8) * 0.03;
        break;
      case 'peek':
        sx = 0.97; sy = 1.07 + Math.sin(t * 2) * 0.02;
        rot = -0.06 + Math.sin(t * 1.4) * 0.03;
        eyeW = 22; eyeH = 50; spacing = 50; tilt = -0.08; lift = -6;
        break;
      case 'watching':
        sx = 1 + Math.sin(t * 3) * 0.02;
        sy = 1 - Math.sin(t * 3) * 0.02;
        rot = Math.sin(t * 1.6) * 0.04;
        eyeW = 25; eyeH = 38; spacing = 50;
        ring = 0.5;
        break;
      case 'needs_you':
        sx = 1 + Math.sin(t * 6) * 0.06;
        sy = 1 - Math.sin(t * 6) * 0.05;
        rot = Math.sin(t * 5) * 0.03;
        eyeW = 27; eyeH = 58; spacing = 54;
        ring = 1;
        break;
      case 'happy':
        sx = 1 + Math.sin(t * 5) * 0.12;
        sy = 1 - Math.sin(t * 5) * 0.12;
        rot = Math.sin(t * 2.5) * 0.09;
        eyeW = 26; eyeH = 44; spacing = 52;
        sparkle = 0.6;
        break;
      case 'annoyed':
        sx = 1.22 + Math.sin(t * 10) * 0.03;
        sy = 0.80 - Math.sin(t * 10) * 0.03;
        rot = Math.sin(t * 7) * 0.03;
        eyeW = 27; eyeH = 20; spacing = 50;
        break;
      case 'dizzy':
        sx = 1 + Math.sin(t * 5) * 0.08;
        sy = 1 - Math.sin(t * 5) * 0.08;
        rot = Math.sin(t * 4) * 0.22;
        eyeW = 22; eyeH = 30; spacing = 50;
        sparkle = 1;
        break;
      case 'asleep':
        sx = 1.34 + Math.sin(t * 0.8) * 0.03;
        sy = 0.66 - Math.sin(t * 0.8) * 0.03;
        rot = Math.sin(t * 0.5) * 0.02;
        eyeW = 26; eyeH = 8; spacing = 52;
        break;
      default:
        sx = 1 + Math.sin(t * 1.5) * 0.03;
        sy = 1 - Math.sin(t * 1.5) * 0.03;
    }

    // Blink-mask morph.
    if (state.blinking) {
      const bf = Math.sin(state.blinkProgress * Math.PI);
      eyeH = Math.max(3, eyeH * (1 - bf * 0.92));
    }

    // --- Studio overlay: design ratios layered on the mood motion ---------
    sx *= studio.bodyW;
    sy *= studio.bodyH;
    rot += rad(studio.bodyRot);

    eyeW *= studio.eyeW / BASE_EYE.w;
    eyeH *= studio.eyeH / BASE_EYE.h;
    spacing *= studio.eyeSpacing / BASE_EYE.spacing;
    tilt += rad(studio.eyeTilt);

    return { sx, sy, rot, eyeW, eyeH, spacing, tilt, lift, ring, sparkle };
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function update() {
    state.time += 0.016;
    const t = state.time;

    const p = computeMoodParams(state.mood, t);
    computeShapeRadii(t);

    const lr = 0.08;
    state.scaleX = lerp(state.scaleX, p.sx, lr);
    state.scaleY = lerp(state.scaleY, p.sy, lr);
    state.rotation = lerp(state.rotation, p.rot, lr);
    state.eyeWidth = lerp(state.eyeWidth, p.eyeW, lr);
    state.eyeHeight = lerp(state.eyeHeight, p.eyeH, lr);
    state.eyeSpacing = lerp(state.eyeSpacing, p.spacing, lr);
    state.eyeTilt = lerp(state.eyeTilt, p.tilt, lr);
    state.eyeLift = lerp(state.eyeLift, p.lift, lr);
    state.ringVis = lerp(state.ringVis, p.ring, 0.06);
    state.sparkleVis = lerp(state.sparkleVis, p.sparkle, 0.06);
    state.orbitVis = lerp(state.orbitVis, studio.rings ? 1 : 0, 0.05);
    state.dustVis = lerp(state.dustVis, studio.particles ? 1 : 0, 0.05);

    // Blob springs (stiffness/damping are studio-tunable).
    const kSpring = studio.stiffness;
    const kDamp = studio.damping;
    for (let i = 0; i < NUM_POINTS; i++) {
      const dist = state.targetRadii[i] - state.currentRadii[i];
      state.velocities[i] = (state.velocities[i] + dist * kSpring) * kDamp;
      state.currentRadii[i] += state.velocities[i];
    }

    if (state.mood === 'happy' || state.mood === 'dizzy') {
      state.floatY = -Math.abs(Math.sin(t * 3.4)) * 14;
    } else if (state.mood === 'asleep') {
      state.floatY = Math.sin(t * 0.8) * 3;
    } else {
      state.floatY = Math.sin(t * 1.1) * 5;
    }

    updateGaze();
    updateBlink();

    // Orbital rings + stardust
    for (const r of orbitalRings) r.angle += r.speed;
    for (const pt of particles) {
      pt.angle += pt.speed;
      pt.alpha = 0.3 + 0.7 * Math.sin(t * 3 + pt.angle);
    }

    const th = theme();
    const [r0, g0, b0, a0] = th.aura;
    const pulse = state.mood === 'needs_you' ? 0.08 * (0.5 + 0.5 * Math.sin(t * 6)) : 0;
    halo.style.background =
      `radial-gradient(circle, rgba(${r0}, ${g0}, ${b0}, ${(a0 + pulse).toFixed(3)}) 0%, transparent 70%)`;
  }

  function updateGaze() {
    if (state.mouse.over) {
      const dx = (state.mouse.x - state.cx) * 0.12;
      const dy = (state.mouse.y - state.cy) * 0.12;
      const maxDist = 26;
      const dist = Math.hypot(dx, dy);
      if (dist > maxDist) {
        state.targetEyeOffset.x = (dx / dist) * maxDist;
        state.targetEyeOffset.y = (dy / dist) * maxDist;
      } else {
        state.targetEyeOffset.x = dx;
        state.targetEyeOffset.y = dy;
      }
    } else if (Math.random() < 0.008) {
      state.targetEyeOffset.x = (Math.random() - 0.5) * 18;
      state.targetEyeOffset.y = (Math.random() - 0.5) * 12;
    }
    const follow = state.mood === 'watching' ? 0.22 : 0.12;
    state.eyeOffset.x = lerp(state.eyeOffset.x, state.targetEyeOffset.x, follow);
    state.eyeOffset.y = lerp(state.eyeOffset.y, state.targetEyeOffset.y, follow);
  }

  function updateBlink() {
    const now = Date.now();
    if (!state.blinking && now > state.nextBlink && state.mood !== 'asleep') {
      state.blinking = true;
      state.blinkProgress = 0;
      state.nextBlink = now + 2500 + Math.random() * 4000;
    }
    if (state.blinking) {
      state.blinkProgress += 0.16;
      if (state.blinkProgress >= 1) {
        state.blinking = false;
        state.blinkProgress = 0;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Drawing helpers
  // ---------------------------------------------------------------------------
  function traceBody() {
    const pts = [];
    for (let i = 0; i < NUM_POINTS; i++) {
      const a = (i / NUM_POINTS) * Math.PI * 2;
      const r = state.currentRadii[i];
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    ctx.beginPath();
    ctx.moveTo((pts[0].x + pts[NUM_POINTS - 1].x) / 2, (pts[0].y + pts[NUM_POINTS - 1].y) / 2);
    for (let i = 0; i < NUM_POINTS; i++) {
      const n = (i + 1) % NUM_POINTS;
      const mx = (pts[i].x + pts[n].x) / 2;
      const my = (pts[i].y + pts[n].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.closePath();
  }

  function drawPillEye(x, y, w, h, tilt, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.fillStyle = color;
    ctx.beginPath();
    const minDim = Math.min(w, h);
    const r = minDim / 2;
    if (ctx.roundRect) {
      ctx.roundRect(-w / 2, -h / 2, w, h, r);
    } else if (h >= w) {
      ctx.arc(0, -h / 2 + r, r, Math.PI, 0);
      ctx.lineTo(r, h / 2 - r);
      ctx.arc(0, h / 2 - r, r, 0, Math.PI);
    } else {
      ctx.arc(-w / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5);
      ctx.lineTo(w / 2 - r, -r);
      ctx.arc(w / 2 - r, 0, r, Math.PI * 1.5, Math.PI / 2);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawCrescentEye(x, y, size, tilt, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(5, size * 0.34);
    ctx.lineCap = 'round';
    const r = Math.max(11, size * 0.72);
    ctx.beginPath();
    ctx.arc(0, r * 0.32, r, Math.PI * 1.14, Math.PI * 1.86);
    ctx.stroke();
    ctx.restore();
  }

  function drawCrossEye(x, y, size, rot, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(4, size * 0.2);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-size / 2, -size / 2); ctx.lineTo(size / 2, size / 2);
    ctx.moveTo(size / 2, -size / 2); ctx.lineTo(-size / 2, size / 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawClosedEye(x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(4, size * 0.16);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, -size * 0.2, size * 0.62, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    ctx.restore();
  }

  function drawStar(x, y, size, rot, fill) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const ox = Math.cos((18 + i * 72) * Math.PI / 180) * size;
      const oy = -Math.sin((18 + i * 72) * Math.PI / 180) * size;
      const ix = Math.cos((54 + i * 72) * Math.PI / 180) * size * 0.45;
      const iy = -Math.sin((54 + i * 72) * Math.PI / 180) * size * 0.45;
      if (i === 0) ctx.moveTo(ox, oy); else ctx.lineTo(ox, oy);
      ctx.lineTo(ix, iy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Accessories
  // ---------------------------------------------------------------------------
  function drawHeadAccessory(kind) {
    const R = state.baseRadius;
    const th = theme();

    if (kind === 'HALO') {
      ctx.save();
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(0, -R - 18, 44, 12, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (kind === 'HORNS') {
      ctx.save();
      ctx.fillStyle = '#FF3B30';
      [-1, 1].forEach((s) => {
        ctx.beginPath();
        ctx.moveTo(s * 34, -R + 12);
        ctx.quadraticCurveTo(s * 46, -R - 26, s * 20, -R - 14);
        ctx.fill();
      });
      ctx.restore();
    } else if (kind === 'ANTENNA') {
      ctx.save();
      ctx.strokeStyle = '#34C759';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, -R + 4);
      ctx.lineTo(0, -R - 30);
      ctx.stroke();
      ctx.fillStyle = '#30B0C7';
      ctx.beginPath();
      ctx.arc(0, -R - 34, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (kind === 'NINJA_MASK') {
      ctx.save();
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.ellipse(0, -R * 0.16, R * 1.02, R * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (kind === 'HERO_MASK') {
      ctx.save();
      ctx.fillStyle = '#C41212';
      ctx.beginPath();
      ctx.moveTo(-R * 0.95, -R * 0.42);
      ctx.quadraticCurveTo(0, -R * 0.66, R * 0.95, -R * 0.42);
      ctx.quadraticCurveTo(R * 1.05, R * 0.05, R * 0.55, R * 0.12);
      ctx.quadraticCurveTo(0, -R * 0.1, -R * 0.55, R * 0.12);
      ctx.quadraticCurveTo(-R * 1.05, R * 0.05, -R * 0.95, -R * 0.42);
      ctx.fill();
      ctx.restore();
    } else if (kind === 'EYEPATCH') {
      ctx.save();
      ctx.fillStyle = '#1C1C1E';
      ctx.beginPath();
      ctx.arc(-state.eyeSpacing / 2, -R * 0.16, R * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3A3A3C';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-R, -R * 0.34);
      ctx.lineTo(R, -R * 0.02);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawAuraAccessoryBehind(kind) {
    const R = state.baseRadius;
    const t = state.time;

    if (kind === 'SUN') {
      ctx.save();
      ctx.translate(0, -R * 0.55);
      ctx.rotate(t * 0.6);
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 5;
      for (let i = 0; i < 12; i++) {
        ctx.rotate(Math.PI / 6);
        ctx.beginPath();
        ctx.moveTo(R * 1.05, 0);
        ctx.lineTo(R * 1.35, 0);
        ctx.stroke();
      }
      ctx.restore();
    } else if (kind === 'RAINBOW') {
      ctx.save();
      const colors = ['#EF4444', '#F97316', '#FACC15', '#10B981', '#06B6D4', '#6366F1', '#8B5CF6'];
      colors.forEach((c, i) => {
        ctx.strokeStyle = c;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, R * (1.05 + i * 0.045), Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      });
      ctx.restore();
    } else if (kind === 'KATANAS') {
      ctx.save();
      ctx.lineCap = 'round';
      [-1, 1].forEach((s, idx) => {
        ctx.strokeStyle = idx === 0 ? '#E2E8F0' : '#CBD5E1';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(s * R * 0.75, -R * 0.8);
        ctx.lineTo(-s * R * 0.75, R * 0.8);
        ctx.stroke();
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(s * R * 0.5, -R * 0.55, 8, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    } else if (kind === 'CAPE') {
      ctx.save();
      const wave = Math.sin(t * 5) * 12;
      ctx.fillStyle = '#E62117';
      ctx.beginPath();
      ctx.moveTo(-R * 0.5, -R * 0.2);
      ctx.quadraticCurveTo(-R + wave, R * 0.45, -R * 0.78 + wave, R * 1.25);
      ctx.quadraticCurveTo(0, R * 1.05, R * 0.78 - wave, R * 1.25);
      ctx.quadraticCurveTo(R - wave, R * 0.45, R * 0.5, -R * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (kind === 'FIRE') {
      ctx.save();
      for (let i = -3; i <= 3; i++) {
        const fx = i * (R * 0.2);
        const fy = -R + R * 0.15;
        const flameH = R * (0.45 + 0.18 * Math.sin(t * 10 + i));
        const grad = ctx.createLinearGradient(fx, fy, fx, fy - flameH);
        grad.addColorStop(0, '#FF3B30');
        grad.addColorStop(0.5, '#FF9500');
        grad.addColorStop(1, '#FFCC00');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(fx - R * 0.12, fy);
        ctx.quadraticCurveTo(fx, fy - flameH * 1.2, fx + R * 0.12, fy);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawAuraAccessoryFront(kind) {
    const R = state.baseRadius;
    const t = state.time;

    if (kind === 'RAIN') {
      ctx.save();
      ctx.fillStyle = '#38BDF8';
      for (let i = 0; i < 5; i++) {
        const rx = -R * 0.7 + i * (R * 0.35);
        const ry = R * 0.75 + ((t * 80 + i * 20) % (R * 0.5));
        ctx.globalAlpha = 1 - (ry - R * 0.75) / (R * 0.5);
        ctx.beginPath();
        ctx.arc(rx, ry, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else if (kind === 'THUNDER') {
      if (Math.sin(t * 12) > 0.3) {
        ctx.save();
        ctx.fillStyle = '#FACC15';
        ctx.strokeStyle = '#EAB308';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, R * 0.5);
        ctx.lineTo(R * 0.22, R * 0.85);
        ctx.lineTo(R * 0.03, R * 0.85);
        ctx.lineTo(R * 0.32, R * 1.25);
        ctx.lineTo(-R * 0.07, R * 0.95);
        ctx.lineTo(R * 0.12, R * 0.95);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    } else if (kind === 'SNOW') {
      ctx.save();
      ctx.strokeStyle = '#93C5FD';
      ctx.lineWidth = 2;
      for (let s = 0; s < 6; s++) {
        const sx = -R * 0.9 + s * (R * 0.36);
        const sy = R * 0.7 + ((t * 40 + s * 15) % (R * 0.6));
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(t + s);
        for (let k = 0; k < 3; k++) {
          ctx.rotate(Math.PI / 3);
          ctx.beginPath();
          ctx.moveTo(-6, 0);
          ctx.lineTo(6, 0);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.restore();
    }
  }

  function drawMoodFrontExtras() {
    const R = state.baseRadius;
    const t = state.time;
    const th = theme();

    if (state.mood === 'watching') {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = th.rim;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 10]);
      ctx.lineDashOffset = -t * 26;
      ctx.beginPath();
      ctx.ellipse(0, 4, R * 1.28, R * 0.52, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (state.mood === 'dizzy') {
      for (let i = 0; i < 3; i++) {
        const a = t * 2.6 + i * (Math.PI * 2 / 3);
        drawStar(Math.cos(a) * R * 1.3, Math.sin(a) * R * 0.55 - R * 0.1, 9, t * 3, '#fde047');
      }
    }

    if (state.mood === 'happy') {
      for (let i = 0; i < 5; i++) {
        const a = t * 1.6 + i * (Math.PI * 2 / 5);
        const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(t * 4 + i));
        ctx.globalAlpha = state.sparkleVis * twinkle;
        drawStar(Math.cos(a) * R * 1.35, Math.sin(a) * R * 0.9 - R * 0.15, 6, t * 2 + i, '#bbf7d0');
      }
      ctx.globalAlpha = 1;
    }

    if (state.mood === 'annoyed') {
      ctx.save();
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      const bx = R * 0.85, by = -R * 0.7;
      [-3, 3].forEach((s) => {
        ctx.beginPath();
        ctx.moveTo(bx + s * 4 - 7, by + s * 4 - 7);
        ctx.lineTo(bx + s * 4 + 7, by + s * 4 + 7);
        ctx.stroke();
      });
      ctx.restore();
    }

    if (state.mood === 'asleep') {
      const zOff = (t * 26) % 60;
      ctx.fillStyle = 'rgba(226, 232, 240, 0.75)';
      ctx.font = '700 16px "JetBrains Mono", monospace';
      ctx.fillText('z', R * 0.75, -R * 0.75 - zOff * 0.5);
      ctx.font = '700 22px "JetBrains Mono", monospace';
      ctx.fillText('Z', R * 0.95, -R * 0.95 - 18 - zOff * 0.8);
    }

    if (state.mood === 'needs_you') {
      const bob = Math.sin(t * 6) * 4;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = th.accent;
      ctx.font = '800 30px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', 0, -R * 1.15 + bob);
      ctx.restore();
    }
  }

  function drawAlertRings() {
    if (state.ringVis <= 0.02) return;
    const R = state.baseRadius;
    const t = state.time;
    const th = theme();
    for (let i = 0; i < 2; i++) {
      const phase = (t * 1.4 + i * 0.5) % 1;
      ctx.beginPath();
      ctx.strokeStyle = th.rim;
      ctx.globalAlpha = state.ringVis * (1 - phase) * 0.55;
      ctx.lineWidth = 3;
      ctx.arc(0, 0, R * (1.15 + phase * 0.7), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawCheeks() {
    const spacing = state.eyeSpacing;
    const eyeY = -state.baseRadius * 0.16 + state.eyeLift + state.eyeOffset.y;
    ctx.fillStyle = 'rgba(255, 105, 180, 0.42)';
    ctx.beginPath();
    ctx.arc(-spacing * 0.78, eyeY + 24, 11, 0, Math.PI * 2);
    ctx.arc(spacing * 0.78, eyeY + 24, 11, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------------------------------------------------------------------------
  // Eyes + mouth
  // ---------------------------------------------------------------------------
  function resolveEyeStyle() {
    if (studio.eyeStyle !== 'AUTO') {
      return { PILL: 'pill', CRESCENT: 'crescent', STERN: 'stern', CIRCLE: 'circle', STAR: 'star' }[studio.eyeStyle] || 'pill';
    }
    return MOOD_EYE_STYLE[state.mood] || 'pill';
  }

  function drawEyesAndMouth() {
    const style = resolveEyeStyle();
    const th = theme();
    const eyeColor = studio.eyeColor;

    const spacing = state.eyeSpacing;
    const gazeX = state.eyeOffset.x;
    const gazeY = state.eyeOffset.y + state.eyeLift + studio.eyeY;

    const eyeY = -state.baseRadius * 0.16 + gazeY;
    const leftX = -spacing / 2 + gazeX;
    const rightX = spacing / 2 + gazeX;

    const rSphere = Math.max(40, state.baseRadius * 0.92);
    const compress = (x) => {
      const ratio = clamp(x / rSphere, -1, 1);
      return Math.max(0.72, Math.sqrt(Math.max(0.52, 1 - ratio * ratio)));
    };
    const lc = compress(leftX);
    const rc = compress(rightX);
    const leftY = eyeY + (1 - lc) * 6;
    const rightY = eyeY + (1 - rc) * 6;

    const eyeW = state.eyeWidth;
    const eyeH = state.eyeHeight;
    const lw = eyeW * lc;
    const rw = eyeW * rc;

    if (style === 'crescent') {
      drawCrescentEye(leftX, leftY, Math.max(lw, 16), -0.26, eyeColor);
      drawCrescentEye(rightX, rightY, Math.max(rw, 16), 0.26, eyeColor);
    } else if (style === 'cross') {
      const rot = state.time * 6;
      drawCrossEye(leftX, leftY, 22, rot, eyeColor);
      drawCrossEye(rightX, rightY, 22, -rot, eyeColor);
    } else if (style === 'closed') {
      drawClosedEye(leftX, leftY, 26, eyeColor);
      drawClosedEye(rightX, rightY, 26, eyeColor);
    } else if (style === 'star') {
      drawStar(leftX, leftY, Math.max(lw, eyeH) * 0.55, state.time * 2, '#FACC15');
      drawStar(rightX, rightY, Math.max(rw, eyeH) * 0.55, -state.time * 2, '#FACC15');
    } else if (style === 'circle') {
      drawPillEye(leftX, leftY, Math.max(lw, eyeH * 0.72), Math.max(lw, eyeH * 0.72), 0, eyeColor);
      drawPillEye(rightX, rightY, Math.max(rw, eyeH * 0.72), Math.max(rw, eyeH * 0.72), 0, eyeColor);
      drawPupils([[leftX, leftY, lw], [rightX, rightY, rw]], eyeH * 0.72, gazeX, gazeY);
    } else if (style === 'stern') {
      drawPillEye(leftX, leftY, lw, eyeH, 0.42, eyeColor);
      drawPillEye(rightX, rightY, rw, eyeH, -0.42, eyeColor);
    } else if (style === 'squint') {
      const sq = Math.max(6, eyeH);
      drawPillEye(leftX, leftY, lw, sq, 0, eyeColor);
      drawPillEye(rightX, rightY, rw, sq, 0, eyeColor);
      ctx.save();
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(leftX - lw * 0.6, leftY - sq * 0.9);
      ctx.lineTo(leftX + lw * 0.6, leftY - sq * 0.55);
      ctx.moveTo(rightX + rw * 0.6, rightY - sq * 0.9);
      ctx.lineTo(rightX - rw * 0.6, rightY - sq * 0.55);
      ctx.stroke();
      ctx.restore();
    } else {
      const blinkHide = state.blinking && (1 - Math.sin(state.blinkProgress * Math.PI)) < 0.35;
      drawPillEye(leftX, leftY, lw, eyeH, -state.eyeTilt, eyeColor);
      drawPillEye(rightX, rightY, rw, eyeH, state.eyeTilt, eyeColor);
      if (!blinkHide && eyeH > 12) drawPupils([[leftX, leftY, lw], [rightX, rightY, rw]], eyeH, gazeX, gazeY);
    }

    // Blush cheeks (studio toggle, or mood default for soft moods).
    if (studio.cheeks || state.mood === 'happy' || state.mood === 'needs_you') {
      drawCheeks();
    }

    drawMouth(eyeY);
  }

  function drawPupils(eyes, eyeH, gazeX, gazeY) {
    const pupilColor = state.mood === 'needs_you' && studio.eyeStyle === 'AUTO' ? '#7c2d12' : '#0A0A0C';
    eyes.forEach(([ex, ey, ew]) => {
      const pr = Math.min(ew, eyeH) * 0.33;
      const px = ex + clamp(gazeX, -(ew / 2 - pr), ew / 2 - pr);
      const py = ey + clamp(gazeY, -(eyeH / 2 - pr), eyeH / 2 - pr);
      ctx.fillStyle = pupilColor;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(px - pr * 0.3, py - pr * 0.3, pr * 0.32, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawMouth(eyeY) {
    const th = theme();
    const eyeColor = studio.eyeColor;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (state.mood === 'happy') {
      ctx.strokeStyle = eyeColor;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, eyeY + 14, 18, 0.12, Math.PI - 0.12);
      ctx.stroke();
    } else if (state.mood === 'needs_you') {
      ctx.fillStyle = '#111115';
      ctx.strokeStyle = th.rim;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, eyeY + 30, 8, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (state.mood === 'annoyed') {
      ctx.strokeStyle = th.rim;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-13, eyeY + 26);
      ctx.lineTo(13, eyeY + 23);
      ctx.stroke();
    } else if (state.mood === 'dizzy') {
      ctx.strokeStyle = eyeColor;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, eyeY + 28, 6, 0, Math.PI * 2);
      ctx.stroke();
    } else if (state.mood === 'asleep') {
      const breath = 3 + Math.abs(Math.sin(state.time * 1.2)) * 3;
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, eyeY + 30, breath, breath, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = eyeColor;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, eyeY + 16, state.mood === 'watching' ? 8 : 11, 0.2, Math.PI - 0.2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRobotVisor() {
    const R = state.baseRadius;
    ctx.save();
    ctx.fillStyle = '#0F172A';
    ctx.strokeStyle = theme().accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-R * 0.55, -R * 0.42, R * 1.1, R * 0.5, 10);
    else ctx.rect(-R * 0.55, -R * 0.42, R * 1.1, R * 0.5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = theme().accent;
    const blink = state.blinking ? 3 : 16;
    ctx.fillRect(-R * 0.32, -R * 0.17 - blink / 2, R * 0.18, blink);
    ctx.fillRect(R * 0.14, -R * 0.17 - blink / 2, R * 0.18, blink);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Orbital rings + stardust (screen space, centred on the blob)
  // ---------------------------------------------------------------------------
  function drawOrbitalRings(inFront) {
    if (state.orbitVis <= 0.01) return;
    const R = state.baseRadius;
    const cxp = state.cx;
    const cyp = state.cy + state.floatY;

    ctx.save();
    ctx.globalAlpha = state.orbitVis;

    for (const ring of orbitalRings) {
      const a = ring.a * R;
      const k = ring.k;
      const kz = Math.sqrt(Math.max(0, 1 - k * k));
      const cu = Math.cos(ring.tilt);
      const su = Math.sin(ring.tilt);
      const samples = 96;
      const pts = [];
      for (let i = 0; i <= samples; i++) {
        const theta = ring.angle + (i / samples) * Math.PI * 2;
        const ct = Math.cos(theta);
        const st = Math.sin(theta);
        const x = a * (ct * cu - st * su * k);
        const y = a * (ct * su + st * cu * k);
        const z = a * st * kz;
        pts.push({ x: cxp + x, y: cyp + y, z });
      }

      let segment = [];
      const flush = () => {
        if (segment.length > 1) renderRingSegment(segment, ring, inFront);
        segment = [];
      };
      for (const p of pts) {
        if ((p.z >= 0) === inFront) segment.push(p);
        else flush();
      }
      flush();
    }
    ctx.restore();
  }

  function renderRingSegment(segment, ring, inFront) {
    if (segment.length < 2) return;
    const R = state.baseRadius;
    ctx.beginPath();
    ctx.moveTo(segment[0].x, segment[0].y);
    for (let i = 1; i < segment.length; i++) ctx.lineTo(segment[i].x, segment[i].y);

    const pStart = segment[0];
    const pEnd = segment[segment.length - 1];
    const grad = ctx.createLinearGradient(pStart.x, pStart.y, pEnd.x, pEnd.y);
    const baseHue = ring.hue + (ring.angle * 180 / Math.PI);
    const span = ring.hueSpan || 180;
    grad.addColorStop(0, `hsl(${Math.round(baseHue) % 360}, 95%, 62%)`);
    grad.addColorStop(0.5, `hsl(${Math.round(baseHue + span * 0.5) % 360}, 95%, 62%)`);
    grad.addColorStop(1, `hsl(${Math.round(baseHue + span) % 360}, 95%, 62%)`);

    const ringWidth = Math.max(3, ring.widthRatio * R);
    ctx.save();
    if (inFront) {
      ctx.shadowColor = 'rgba(0, 229, 255, 0.45)';
      ctx.shadowBlur = Math.max(4, ringWidth * 1.2);
    }
    ctx.strokeStyle = grad;
    ctx.lineWidth = ringWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  function drawParticles(inFront) {
    if (state.dustVis <= 0.01) return;
    const cxp = state.cx;
    const cyp = state.cy + state.floatY;
    ctx.save();
    ctx.globalAlpha = state.dustVis;
    for (const p of particles) {
      const x = cxp + Math.cos(p.angle) * p.dist;
      const y = cyp + Math.sin(p.angle) * (p.dist * 0.4) + p.yOffset;
      const z = Math.sin(p.angle);
      if ((z >= 0) !== inFront) continue;
      ctx.fillStyle = `rgba(125, 211, 252, ${p.alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Body
  // ---------------------------------------------------------------------------
  function drawBody() {
    const th = theme();
    const bodyColor = studio.bodyColor;

    ctx.save();
    ctx.translate(state.cx, state.cy + state.floatY);
    ctx.rotate(state.rotation);
    ctx.scale(state.scaleX, state.scaleY);

    // Behind-body extras
    drawAuraAccessoryBehind(studio.aura);
    drawAlertRings();

    // Soft outer glow
    ctx.save();
    ctx.shadowColor = th.accent;
    ctx.shadowBlur = state.mood === 'needs_you' ? 30 + Math.sin(state.time * 6) * 10 : 20;
    ctx.fillStyle = bodyColor;
    traceBody();
    ctx.fill();
    ctx.restore();

    // Mercury specular highlight (clipped to the body)
    ctx.save();
    traceBody();
    ctx.clip();
    const R = state.baseRadius;
    const spec = ctx.createRadialGradient(-R * 0.38, -R * 0.42, R * 0.05, -R * 0.38, -R * 0.42, R * 1.15);
    spec.addColorStop(0, 'rgba(255, 255, 255, 0.20)');
    spec.addColorStop(0.45, 'rgba(255, 255, 255, 0.05)');
    spec.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = spec;
    ctx.fillRect(-R * 1.6, -R * 1.6, R * 3.2, R * 3.2);
    ctx.restore();

    // Accent rim light
    ctx.save();
    ctx.strokeStyle = th.rim;
    ctx.globalAlpha = state.mood === 'needs_you' ? 0.55 : 0.34;
    ctx.lineWidth = 2.5;
    traceBody();
    ctx.stroke();
    ctx.restore();

    // Head pieces that sit behind the face
    if (studio.head === 'HALO' || studio.head === 'HORNS' || studio.head === 'ANTENNA') {
      drawHeadAccessory(studio.head);
    }

    // Face
    if (studio.shape === 'ROBOT') {
      drawRobotVisor();
    } else {
      drawEyesAndMouth();
    }

    // Head pieces that cover part of the face
    if (studio.head === 'NINJA_MASK' || studio.head === 'HERO_MASK' || studio.head === 'EYEPATCH') {
      drawHeadAccessory(studio.head);
    }

    // In-front extras
    drawAuraAccessoryFront(studio.aura);
    drawMoodFrontExtras();

    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, state.W, state.H);

    const [r, g, b, a] = theme().aura;
    const pulse = state.mood === 'needs_you' ? 0.12 * (0.5 + 0.5 * Math.sin(state.time * 6)) : 0;
    const grad = ctx.createRadialGradient(
      state.cx, state.cy, state.baseRadius * 0.35,
      state.cx, state.cy, state.baseRadius * 2.3
    );
    grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${(a + pulse).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(state.cx, state.cy, state.baseRadius * 2.3, 0, Math.PI * 2);
    ctx.fill();

    drawOrbitalRings(false);
    drawParticles(false);
    drawBody();
    drawOrbitalRings(true);
    drawParticles(true);
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  function animate() {
    update();
    draw();
    requestAnimationFrame(animate);
  }

  // ---------------------------------------------------------------------------
  // Pointer interaction
  // ---------------------------------------------------------------------------
  window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    state.mouse.x = e.clientX - rect.left;
    state.mouse.y = e.clientY - rect.top;
    state.mouse.over = true;
  });

  canvas.addEventListener('mouseleave', () => { state.mouse.over = false; });

  canvas.addEventListener('click', triggerPoke);
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    triggerPoke();
  }, { passive: false });

  function triggerPoke() {
    applyImpulse(36);
    state.scaleX = 1.3;
    state.scaleY = 0.75;
    triggerBlink();
    if (navigator.vibrate) {
      try { navigator.vibrate(20); } catch (e) {}
    }
    fetch('/api/poke', { method: 'POST' }).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Server-driven UI state
  // ---------------------------------------------------------------------------
  function setMood(mood) {
    if (mood === state.mood) return;
    if (!MOOD_THEMES[mood]) mood = 'idle';
    state.mood = mood;
    triggerBlink();
  }

  function updateUI(status) {
    if (!status) return;
    setMood(status.mood || 'idle');
    state.activeRequest = status.active_request;
    state.paired = !!status.paired;

    const th = theme();
    moodBadge.textContent = state.mood;
    moodBadge.className = `mood-badge mood-${state.mood}`;
    moodBadge.style.color = th.accent;
    moodBadge.style.borderColor = th.accent + '55';
    moodBadge.style.background = th.accent + '1a';
    oneLiner.textContent = status.one_liner || 'Pip is standing by';

    if (status.has_bridge) {
      bridgePill.className = 'pill status-pill active';
      bridgePill.querySelector('.pill-text').textContent = 'LED Matrix: Linked';
    } else {
      bridgePill.className = 'pill status-pill';
      bridgePill.querySelector('.pill-text').textContent = 'LED Matrix: Standalone';
    }

    if (state.paired) {
      pairPill.className = 'pill status-pill active';
      pairStatusText.textContent = 'Laptop Paired';
    } else {
      pairPill.className = 'pill status-pill warning';
      pairStatusText.textContent = 'Unpaired';
    }

    if (state.activeRequest) {
      approvalCard.classList.remove('hidden');
      approvalAgent.textContent = (state.activeRequest.agent || 'AGENT').toUpperCase();
      approvalSummary.textContent = state.activeRequest.summary || 'Approval Requested';
      approvalCommand.textContent = state.activeRequest.command || '';
    } else {
      approvalCard.classList.add('hidden');
    }
  }

  function initSSE() {
    const evtSource = new EventSource('/api/stream');
    evtSource.onmessage = function (e) {
      try {
        const data = JSON.parse(e.data);
        if (data.status) updateUI(data.status);
      } catch (err) { /* ignore */ }
    };
    evtSource.onerror = function () {
      evtSource.close();
      setTimeout(initSSE, 3000);
    };
  }

  function pollStatus() {
    fetch('/api/status').then((res) => res.json()).then(updateUI).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Design Studio wiring
  // ---------------------------------------------------------------------------
  function syncStudioUI() {
    const q = (id) => document.getElementById(id);

    document.querySelectorAll('#studio-shapes [data-shape]').forEach((b) =>
      b.classList.toggle('active', b.dataset.shape === studio.shape));
    document.querySelectorAll('#studio-eyestyles [data-eyestyle]').forEach((b) =>
      b.classList.toggle('active', b.dataset.eyestyle === studio.eyeStyle));

    const setSlider = (id, val, labelId, fmt) => {
      const el = q(id);
      if (!el) return;
      el.value = val;
      const lb = q(labelId);
      if (lb) lb.textContent = fmt(val);
    };

    setSlider('studio-body-w', studio.bodyW, 'val-body-w', (v) => Number(v).toFixed(2) + '×');
    setSlider('studio-body-h', studio.bodyH, 'val-body-h', (v) => Number(v).toFixed(2) + '×');
    setSlider('studio-body-rot', studio.bodyRot, 'val-body-rot', (v) => v + '°');
    setSlider('studio-stiffness', studio.stiffness, 'val-stiffness', (v) => Number(v).toFixed(2));
    setSlider('studio-damping', studio.damping, 'val-damping', (v) => Number(v).toFixed(2));
    setSlider('studio-eye-w', studio.eyeW, 'val-eye-w', (v) => v + 'px');
    setSlider('studio-eye-h', studio.eyeH, 'val-eye-h', (v) => v + 'px');
    setSlider('studio-eye-spacing', studio.eyeSpacing, 'val-eye-spacing', (v) => v + 'px');
    setSlider('studio-eye-tilt', studio.eyeTilt, 'val-eye-tilt', (v) => v + '°');
    setSlider('studio-eye-y', studio.eyeY, 'val-eye-y', (v) => v + 'px');

    if (q('studio-head')) q('studio-head').value = studio.head;
    if (q('studio-aura')) q('studio-aura').value = studio.aura;
    if (q('studio-cheeks')) q('studio-cheeks').checked = studio.cheeks;
    if (q('studio-rings')) q('studio-rings').checked = studio.rings;
    if (q('studio-particles')) q('studio-particles').checked = studio.particles;
    if (q('studio-body-color')) q('studio-body-color').value = studio.bodyColor;
    if (q('studio-eye-color')) q('studio-eye-color').value = studio.eyeColor;
  }

  function bindSlider(id, key, fmt) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      studio[key] = parseFloat(el.value);
      const lb = document.getElementById(id.replace('studio-', 'val-'));
      if (lb) lb.textContent = fmt(el.value);
      saveStudio();
    });
  }

  function initStudioUI() {
    const q = (id) => document.getElementById(id);

    if (btnStudio) btnStudio.addEventListener('click', () => studioDrawer.classList.toggle('collapsed'));
    if (btnCloseStudio) btnCloseStudio.addEventListener('click', () => studioDrawer.classList.add('collapsed'));
    if (btnResetStudio) btnResetStudio.addEventListener('click', resetStudio);

    // Chip groups
    document.querySelectorAll('#studio-shapes [data-shape]').forEach((b) =>
      b.addEventListener('click', () => { studio.shape = b.dataset.shape; saveStudio(); syncStudioUI(); triggerBlink(); }));
    document.querySelectorAll('#studio-eyestyles [data-eyestyle]').forEach((b) =>
      b.addEventListener('click', () => { studio.eyeStyle = b.dataset.eyestyle; saveStudio(); syncStudioUI(); }));

    // Sliders
    bindSlider('studio-body-w', 'bodyW', (v) => Number(v).toFixed(2) + '×');
    bindSlider('studio-body-h', 'bodyH', (v) => Number(v).toFixed(2) + '×');
    bindSlider('studio-body-rot', 'bodyRot', (v) => v + '°');
    bindSlider('studio-stiffness', 'stiffness', (v) => Number(v).toFixed(2));
    bindSlider('studio-damping', 'damping', (v) => Number(v).toFixed(2));
    bindSlider('studio-eye-w', 'eyeW', (v) => v + 'px');
    bindSlider('studio-eye-h', 'eyeH', (v) => v + 'px');
    bindSlider('studio-eye-spacing', 'eyeSpacing', (v) => v + 'px');
    bindSlider('studio-eye-tilt', 'eyeTilt', (v) => v + '°');
    bindSlider('studio-eye-y', 'eyeY', (v) => v + 'px');

    // Selects
    if (q('studio-head')) q('studio-head').addEventListener('change', (e) => { studio.head = e.target.value; saveStudio(); });
    if (q('studio-aura')) q('studio-aura').addEventListener('change', (e) => { studio.aura = e.target.value; saveStudio(); });

    // Toggles
    if (q('studio-cheeks')) q('studio-cheeks').addEventListener('change', (e) => { studio.cheeks = e.target.checked; saveStudio(); });
    if (q('studio-rings')) q('studio-rings').addEventListener('change', (e) => { studio.rings = e.target.checked; saveStudio(); });
    if (q('studio-particles')) q('studio-particles').addEventListener('change', (e) => { studio.particles = e.target.checked; saveStudio(); });

    // Colors
    if (q('studio-body-color')) q('studio-body-color').addEventListener('input', (e) => { studio.bodyColor = e.target.value; saveStudio(); });
    if (q('studio-eye-color')) q('studio-eye-color').addEventListener('input', (e) => { studio.eyeColor = e.target.value; saveStudio(); });
    document.querySelectorAll('#studio-body-swatches [data-color]').forEach((b) =>
      b.addEventListener('click', () => {
        studio.bodyColor = b.dataset.color;
        saveStudio();
        if (q('studio-body-color')) q('studio-body-color').value = studio.bodyColor;
      }));

    const openStudio = () => studioDrawer.classList.remove('collapsed');
    const hash = window.location.hash.replace('#', '');
    if (hash === 'studio' || hash === 'design') setTimeout(openStudio, 300);
  }

  // ---------------------------------------------------------------------------
  // Decision / demo / chat / pairing handlers
  // ---------------------------------------------------------------------------
  btnAllow.addEventListener('click', () => {
    if (!state.activeRequest) return;
    fetch('/api/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: state.activeRequest.request_id, decision: 'allow', source: 'web_ui' })
    }).catch(() => {});
  });

  btnDeny.addEventListener('click', () => {
    if (!state.activeRequest) return;
    fetch('/api/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: state.activeRequest.request_id, decision: 'deny', source: 'web_ui' })
    }).catch(() => {});
  });

  btnPoke.addEventListener('click', triggerPoke);

  btnDemo.addEventListener('click', () => {
    btnDemo.disabled = true;
    btnDemo.textContent = 'Running Demo...';
    fetch('/api/demo', { method: 'POST' })
      .finally(() => {
        setTimeout(() => {
          btnDemo.disabled = false;
          btnDemo.innerHTML = '<span>▶</span> Try 60s Demo';
        }, 15000);
      });
  });

  btnToggleChat.addEventListener('click', () => {
    chatSection.classList.toggle('collapsed');
    if (!chatSection.classList.contains('collapsed')) chatInput.focus();
  });

  btnCloseChat.addEventListener('click', () => chatSection.classList.add('collapsed'));

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (!msg) return;
    appendChatMsg('You', msg, 'user-msg');
    chatInput.value = '';
    setMood('watching');

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    })
      .then((r) => r.json())
      .then((data) => appendChatMsg('Pip', data.reply, 'pip-msg'))
      .catch(() => appendChatMsg('Pip', 'Oops, brain hiccup! Still watching your agents though! [o_o]', 'pip-msg'));
  });

  function appendChatMsg(sender, text, className) {
    const div = document.createElement('div');
    div.className = `msg ${className}`;
    div.innerHTML = `<div class="sender">${escapeHtml(sender)}</div><div class="bubble">${escapeHtml(text)}</div>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  btnPairModal.addEventListener('click', () => pairModal.classList.remove('hidden'));
  btnCloseModal.addEventListener('click', () => pairModal.classList.add('hidden'));

  btnSubmitPair.addEventListener('click', () => {
    const code = pairCodeInput.value.trim();
    const laptopUrl = laptopUrlInput.value.trim();
    if (!code) return;
    fetch('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, laptop_url: laptopUrl })
    })
      .then((r) => r.json())
      .then(() => { pairModal.classList.add('hidden'); pollStatus(); })
      .catch(() => {});
  });

  btnUnpair.addEventListener('click', () => {
    fetch('/api/unpair', { method: 'POST' }).then(() => {
      pairModal.classList.add('hidden');
      pollStatus();
    }).catch(() => {});
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  resize();
  initBlob();
  initParticles();
  loadStudio();
  initStudioUI();
  syncStudioUI();
  pollStatus();
  initSSE();
  requestAnimationFrame(animate);
})();
