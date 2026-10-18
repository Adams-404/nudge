/**
 * Nudge - Pip Character Engine & Web UI Controller
 *
 * Pip is now a living liquid blob: a 16-point Bezier spring-physics jelly
 * body with a pure-black mercury silhouette, mood-driven shape morphing,
 * spherical eye depth, blink-masked transitions and procedural accessory FX.
 *
 * The Nudge contract is unchanged: same DOM ids, same SSE /status stream,
 * same POST /api/poke, /api/decision, /api/chat and pairing flow.
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

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  const LOGICAL_SIZE = 360;      // canvas is a fixed 360x360 CSS box
  const BODY_COLOR = '#0A0A0C';  // iconic Nudge/KuroBlob pure-black mercury
  const EYE_COLOR = '#FFFFFF';
  const NUM_POINTS = 16;         // 16-point Bezier control ring
  const SPRING_STIFFNESS = 0.13;
  const DAMPING = 0.82;

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

  const EYE_STYLE = {
    idle: 'pill', peek: 'pill', watching: 'pill', needs_you: 'pill',
    happy: 'crescent', annoyed: 'squint', dizzy: 'cross', asleep: 'closed'
  };

  // ---------------------------------------------------------------------------
  // Engine state
  // ---------------------------------------------------------------------------
  const state = {
    mood: 'idle',
    activeRequest: null,
    paired: false,

    // Canvas space
    W: LOGICAL_SIZE,
    H: LOGICAL_SIZE,
    cx: LOGICAL_SIZE / 2,
    cy: LOGICAL_SIZE / 2,
    baseRadius: 92,

    // Blob springs
    currentRadii: new Float32Array(NUM_POINTS),
    targetRadii: new Float32Array(NUM_POINTS),
    velocities: new Float32Array(NUM_POINTS),

    // Body transform (lerped toward mood targets)
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    floatY: 0,

    // Eyes (lerped toward mood targets)
    eyeWidth: 22,
    eyeHeight: 46,
    eyeSpacing: 52,
    eyeTilt: 0,
    eyeLift: 0,     // extra vertical baseline for "peek up" looks

    // Gaze
    mouse: { x: LOGICAL_SIZE / 2, y: LOGICAL_SIZE / 2, over: false },
    eyeOffset: { x: 0, y: 0 },
    targetEyeOffset: { x: 0, y: 0 },

    // Blink
    blinking: false,
    blinkProgress: 0,
    nextBlink: Date.now() + 3200,

    time: 0,
    lastFrame: 0,

    // FX visibilities
    ringVis: 0,
    sparkleVis: 0
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const theme = () => MOOD_THEMES[state.mood] || MOOD_THEMES.idle;

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
  // Mood -> target parameters (the "expression brain")
  // ---------------------------------------------------------------------------
  function computeMoodParams(mood, t) {
    let sx = 1, sy = 1, rot = 0;
    let eyeW = 22, eyeH = 46, spacing = 52, tilt = 0, lift = 0;
    let ring = 0, sparkle = 0;

    switch (mood) {
      case 'idle':
        sx = 1 + Math.sin(t * 1.5) * 0.03;
        sy = 1 - Math.sin(t * 1.5) * 0.03;
        rot = Math.sin(t * 0.8) * 0.03;
        break;

      case 'peek':
        // Perked up, slightly egg-shaped, curious side-glance.
        sx = 0.97;
        sy = 1.07 + Math.sin(t * 2) * 0.02;
        rot = -0.06 + Math.sin(t * 1.4) * 0.03;
        eyeW = 22; eyeH = 50; spacing = 50; tilt = -0.08; lift = -6;
        break;

      case 'watching':
        // Focused, scanning wide gaze with a rotating radar ring.
        sx = 1 + Math.sin(t * 3) * 0.02;
        sy = 1 - Math.sin(t * 3) * 0.02;
        rot = Math.sin(t * 1.6) * 0.04;
        eyeW = 25; eyeH = 38; spacing = 50;
        ring = 0.5;
        break;

      case 'needs_you':
        // Urgent pleading pulse + glowing alert rings.
        sx = 1 + Math.sin(t * 6) * 0.06;
        sy = 1 - Math.sin(t * 6) * 0.05;
        rot = Math.sin(t * 5) * 0.03;
        eyeW = 27; eyeH = 58; spacing = 54;
        ring = 1;
        break;

      case 'happy':
        // Bouncy jelly squash-stretch with happy sparkles.
        sx = 1 + Math.sin(t * 5) * 0.12;
        sy = 1 - Math.sin(t * 5) * 0.12;
        rot = Math.sin(t * 2.5) * 0.09;
        eyeW = 26; eyeH = 44; spacing = 52;
        sparkle = 0.6;
        break;

      case 'annoyed':
        // Flattened, vibrating, skeptical.
        sx = 1.22 + Math.sin(t * 10) * 0.03;
        sy = 0.80 - Math.sin(t * 10) * 0.03;
        rot = Math.sin(t * 7) * 0.03;
        eyeW = 27; eyeH = 20; spacing = 50;
        break;

      case 'dizzy':
        // Wavy ripple body with spinning crossed eyes & orbiting stars.
        sx = 1 + Math.sin(t * 5) * 0.08;
        sy = 1 - Math.sin(t * 5) * 0.08;
        rot = Math.sin(t * 4) * 0.22;
        eyeW = 22; eyeH = 30; spacing = 50;
        sparkle = 1;
        break;

      case 'asleep':
        // Slow flat puddle breathing.
        sx = 1.34 + Math.sin(t * 0.8) * 0.03;
        sy = 0.66 - Math.sin(t * 0.8) * 0.03;
        rot = Math.sin(t * 0.5) * 0.02;
        eyeW = 26; eyeH = 8; spacing = 52;
        break;

      default:
        sx = 1 + Math.sin(t * 1.5) * 0.03;
        sy = 1 - Math.sin(t * 1.5) * 0.03;
    }

    // Blink-mask morph: a natural blink whenever the silhouette changes.
    if (state.blinking) {
      const bf = Math.sin(state.blinkProgress * Math.PI);
      eyeH = Math.max(3, eyeH * (1 - bf * 0.92));
    }

    return { sx, sy, rot, eyeW, eyeH, spacing, tilt, lift, ring, sparkle };
  }

  function computeShapeRadii(mood, t) {
    for (let i = 0; i < NUM_POINTS; i++) {
      const a = (i / NUM_POINTS) * Math.PI * 2;
      let r = state.baseRadius;

      if (mood === 'annoyed') {
        r = state.baseRadius * (1 + 0.12 * Math.cos(a * 4));
      } else if (mood === 'dizzy') {
        r = state.baseRadius * (1 + 0.17 * Math.sin(a * 4 + t * 5));
      } else if (mood === 'peek') {
        r = state.baseRadius * (1 + 0.10 * Math.sin(a));
      } else if (mood === 'watching') {
        // Subtle squircle focus for a "locked on" read.
        r = state.baseRadius * (1 + 0.05 * Math.cos(a * 4));
      } else {
        // Organic liquid breathing.
        r = state.baseRadius * (1 + Math.sin(t * 2 + a * 2) * 0.05);
      }

      state.targetRadii[i] = r;
    }
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function update() {
    state.time += 0.016;
    const t = state.time;

    const p = computeMoodParams(state.mood, t);
    computeShapeRadii(state.mood, t);

    // Smoothly lerp body transform & eyes toward the mood targets.
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

    // Blob springs
    for (let i = 0; i < NUM_POINTS; i++) {
      const dist = state.targetRadii[i] - state.currentRadii[i];
      state.velocities[i] = (state.velocities[i] + dist * SPRING_STIFFNESS) * DAMPING;
      state.currentRadii[i] += state.velocities[i];
    }

    // Float / bounce
    if (state.mood === 'happy' || state.mood === 'dizzy') {
      state.floatY = -Math.abs(Math.sin(t * 3.4)) * 14;
    } else if (state.mood === 'asleep') {
      state.floatY = Math.sin(t * 0.8) * 3;
    } else {
      state.floatY = Math.sin(t * 1.1) * 5;
    }

    updateGaze();
    updateBlink();

    // Halo element follows the mood accent.
    const th = theme();
    const [r, g, b, a] = th.aura;
    const pulse = state.mood === 'needs_you' ? 0.08 * (0.5 + 0.5 * Math.sin(t * 6)) : 0;
    halo.style.background =
      `radial-gradient(circle, rgba(${r}, ${g}, ${b}, ${(a + pulse).toFixed(3)}) 0%, transparent 70%)`;
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
      // Idle micro-saccades.
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
  // Accessories (behind / in front of body)
  // ---------------------------------------------------------------------------
  function drawBackAccessories() {
    const R = state.baseRadius;
    const t = state.time;

    // Perked ear nubs while peeking.
    if (state.mood === 'peek') {
      ctx.fillStyle = BODY_COLOR;
      ctx.strokeStyle = theme().rim;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.9;
      [-1, 1].forEach((s) => {
        ctx.beginPath();
        ctx.arc(s * R * 0.5, -R * 0.92, R * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    // Alert rings for needs_you (behind the body, pulsing outward).
    if (state.ringVis > 0.02) {
      const th = theme();
      for (let i = 0; i < 2; i++) {
        const phase = (t * 1.4 + i * 0.5) % 1;
        const rr = R * (1.15 + phase * 0.7);
        ctx.beginPath();
        ctx.strokeStyle = th.rim;
        ctx.globalAlpha = state.ringVis * (1 - phase) * 0.55;
        ctx.lineWidth = 3;
        ctx.arc(0, 0, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawFrontAccessories() {
    const R = state.baseRadius;
    const t = state.time;
    const th = theme();

    // Rotating radar ring while watching.
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

    // Orbiting stars while dizzy.
    if (state.mood === 'dizzy') {
      for (let i = 0; i < 3; i++) {
        const a = t * 2.6 + i * (Math.PI * 2 / 3);
        const x = Math.cos(a) * R * 1.3;
        const y = Math.sin(a) * R * 0.55 - R * 0.1;
        drawStar(x, y, 9, t * 3, '#fde047');
      }
    }

    // Happy sparkles.
    if (state.mood === 'happy') {
      for (let i = 0; i < 5; i++) {
        const a = t * 1.6 + i * (Math.PI * 2 / 5);
        const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(t * 4 + i));
        const x = Math.cos(a) * R * 1.35;
        const y = Math.sin(a) * R * 0.9 - R * 0.15;
        ctx.globalAlpha = state.sparkleVis * twinkle;
        drawStar(x, y, 6, t * 2 + i, '#bbf7d0');
      }
      ctx.globalAlpha = 1;
    }

    // Anger marks while annoyed.
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

    // Floating "z Z" while asleep.
    if (state.mood === 'asleep') {
      const zOff = (t * 26) % 60;
      ctx.fillStyle = 'rgba(226, 232, 240, 0.75)';
      ctx.font = '700 16px "JetBrains Mono", monospace';
      ctx.fillText('z', R * 0.75, -R * 0.75 - zOff * 0.5);
      ctx.font = '700 22px "JetBrains Mono", monospace';
      ctx.fillText('Z', R * 0.95, -R * 0.95 - 18 - zOff * 0.8);
    }

    // Steady attention beacon above the head when approval is pending.
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

  // ---------------------------------------------------------------------------
  // Eyes + mouth
  // ---------------------------------------------------------------------------
  function drawEyesAndMouth() {
    const style = EYE_STYLE[state.mood] || 'pill';
    const th = theme();
    const spacing = state.eyeSpacing;
    const gazeX = state.eyeOffset.x;
    const gazeY = state.eyeOffset.y + state.eyeLift;

    const eyeY = -state.baseRadius * 0.16 + gazeY;
    const leftX = -spacing / 2 + gazeX;
    const rightX = spacing / 2 + gazeX;

    // Spherical orthographic foreshortening: eyes near the silhouette edge
    // compress gracefully, giving the flat canvas a real 3D read.
    const rSphere = Math.max(40, state.baseRadius * 0.92);
    const compress = (x) => {
      const ratio = clamp(x / rSphere, -1, 1);
      return Math.max(0.72, Math.sqrt(Math.max(0.52, 1 - ratio * ratio)));
    };
    const lc = compress(leftX);
    const rc = compress(rightX);
    const leftY = eyeY + (1 - lc) * 6;
    const rightY = eyeY + (1 - rc) * 6;

    let eyeW = state.eyeWidth;
    let eyeH = state.eyeHeight;
    const lw = eyeW * lc;
    const rw = eyeW * rc;

    if (style === 'crescent') {
      drawCrescentEye(leftX, leftY, Math.max(lw, 16), -0.26, EYE_COLOR);
      drawCrescentEye(rightX, rightY, Math.max(rw, 16), 0.26, EYE_COLOR);
    } else if (style === 'cross') {
      const rot = state.time * 6;
      drawCrossEye(leftX, leftY, 22, rot, EYE_COLOR);
      drawCrossEye(rightX, rightY, 22, -rot, EYE_COLOR);
    } else if (style === 'closed') {
      drawClosedEye(leftX, leftY, 26, EYE_COLOR);
      drawClosedEye(rightX, rightY, 26, EYE_COLOR);
    } else if (style === 'squint') {
      // Light squint + heavy skeptical brows.
      const sq = Math.max(6, eyeH);
      drawPillEye(leftX, leftY, lw, sq, 0, EYE_COLOR);
      drawPillEye(rightX, rightY, rw, sq, 0, EYE_COLOR);
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
      // Pill eyes with lively tracking pupils.
      const blinkHide = state.blinking && (1 - Math.sin(state.blinkProgress * Math.PI)) < 0.35;
      drawPillEye(leftX, leftY, lw, eyeH, -state.eyeTilt, EYE_COLOR);
      drawPillEye(rightX, rightY, rw, eyeH, state.eyeTilt, EYE_COLOR);

      if (!blinkHide && eyeH > 12) {
        const pupilColor = state.mood === 'needs_you' ? '#7c2d12' : '#0A0A0C';
        [[leftX, leftY, lw], [rightX, rightY, rw]].forEach(([ex, ey, ew]) => {
          const pr = Math.min(ew, eyeH) * 0.33;
          const px = ex + clamp(gazeX, -(ew / 2 - pr), ew / 2 - pr);
          const py = ey + clamp(gazeY, -(eyeH / 2 - pr), eyeH / 2 - pr);
          ctx.fillStyle = pupilColor;
          ctx.beginPath();
          ctx.arc(px, py, pr, 0, Math.PI * 2);
          ctx.fill();
          if (state.mood !== 'needs_you') {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(px - pr * 0.3, py - pr * 0.3, pr * 0.32, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      }
    }

    // Cheeks for the softer moods.
    if (state.mood === 'happy' || state.mood === 'needs_you') {
      ctx.fillStyle = state.mood === 'needs_you'
        ? 'rgba(251, 191, 36, 0.35)'
        : 'rgba(255, 105, 180, 0.42)';
      ctx.beginPath();
      ctx.arc(-spacing * 0.78, eyeY + 24, 11, 0, Math.PI * 2);
      ctx.arc(spacing * 0.78, eyeY + 24, 11, 0, Math.PI * 2);
      ctx.fill();
    }

    drawMouth(eyeY);
  }

  function drawMouth(eyeY) {
    const th = theme();
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (state.mood === 'happy') {
      ctx.strokeStyle = EYE_COLOR;
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
      ctx.strokeStyle = EYE_COLOR;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, eyeY + 28, 6, 0, Math.PI * 2);
      ctx.stroke();
    } else if (state.mood === 'asleep') {
      // Tiny slow breathing "o".
      const breath = 3 + Math.abs(Math.sin(state.time * 1.2)) * 3;
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, eyeY + 30, breath, breath, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // idle / peek / watching: soft smile.
      ctx.strokeStyle = EYE_COLOR;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, eyeY + 16, state.mood === 'watching' ? 8 : 11, 0.2, Math.PI - 0.2);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Body
  // ---------------------------------------------------------------------------
  function drawBody() {
    const th = theme();

    ctx.save();
    ctx.translate(state.cx, state.cy + state.floatY);
    ctx.rotate(state.rotation);
    ctx.scale(state.scaleX, state.scaleY);

    // 1. Back accessories
    drawBackAccessories();

    // 2. Soft outer glow behind the silhouette
    ctx.save();
    ctx.shadowColor = th.accent;
    ctx.shadowBlur = state.mood === 'needs_you'
      ? 30 + Math.sin(state.time * 6) * 10
      : 20;
    ctx.fillStyle = BODY_COLOR;
    traceBody();
    ctx.fill();
    ctx.restore();

    // 3. Mercury specular highlight (clipped to the body)
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

    // 4. Accent rim light so the pure black blob reads on the dark page.
    ctx.save();
    ctx.strokeStyle = th.rim;
    ctx.globalAlpha = state.mood === 'needs_you' ? 0.55 : 0.34;
    ctx.lineWidth = 2.5;
    traceBody();
    ctx.stroke();
    ctx.restore();

    // 5. Front accessories, eyes and mouth
    drawFrontAccessories();
    drawEyesAndMouth();

    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, state.W, state.H);

    // Ambient mood aura.
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

    drawBody();
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

  canvas.addEventListener('mouseleave', () => {
    state.mouse.over = false;
  });

  canvas.addEventListener('click', triggerPoke);
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    triggerPoke();
  }, { passive: false });

  function triggerPoke() {
    // Poke reaction: impulse, squish, blink, haptics.
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
    triggerBlink(); // blink-mask the silhouette change
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
      } catch (err) { /* ignore malformed frames */ }
    };
    evtSource.onerror = function () {
      evtSource.close();
      setTimeout(initSSE, 3000);
    };
  }

  function pollStatus() {
    fetch('/api/status')
      .then((res) => res.json())
      .then(updateUI)
      .catch(() => {});
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
      .catch(() => {
        appendChatMsg('Pip', 'Oops, brain hiccup! Still watching your agents though! [o_o]', 'pip-msg');
      });
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
      .then(() => {
        pairModal.classList.add('hidden');
        pollStatus();
      })
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
  pollStatus();
  initSSE();
  requestAnimationFrame(animate);
})();
