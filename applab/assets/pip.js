/**
 * Nudge - Pip Character Engine & Web UI Controller
 * Procedural Canvas 2D squircle creature with dynamic eye tracking,
 * spring physics, mood expressions, and real-time SSE sync.
 */

(function() {
  const canvas = document.getElementById('pip-canvas');
  const ctx = canvas.getContext('2d');
  const halo = document.getElementById('halo-glow');

  // UI Elements
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

  // Character State
  let currentMood = 'idle';
  let activeRequest = null;
  let isPaired = false;
  let mouse = { x: 180, y: 180, targetX: 180, targetY: 180 };
  let squish = { x: 1, y: 1, vx: 0, vy: 0 };
  let blink = { progress: 0, isBlinking: false, nextTime: Date.now() + 3000 };
  let dizzyAngle = 0;
  let floatOffset = 0;

  // Colors per mood
  const MOOD_THEMES = {
    idle:      { bodyTop: '#38bdf8', bodyBot: '#0284c7', halo: 'rgba(56, 189, 248, 0.25)' },
    peek:      { bodyTop: '#60a5fa', bodyBot: '#2563eb', halo: 'rgba(96, 165, 250, 0.25)' },
    watching:  { bodyTop: '#818cf8', bodyBot: '#4f46e5', halo: 'rgba(129, 140, 248, 0.3)' },
    needs_you: { bodyTop: '#fbbf24', bodyBot: '#d97706', halo: 'rgba(251, 191, 36, 0.45)' },
    happy:     { bodyTop: '#4ade80', bodyBot: '#16a34a', halo: 'rgba(74, 222, 128, 0.35)' },
    annoyed:   { bodyTop: '#f87171', bodyBot: '#dc2626', halo: 'rgba(248, 113, 113, 0.3)' },
    dizzy:     { bodyTop: '#c084fc', bodyBot: '#9333ea', halo: 'rgba(192, 132, 252, 0.35)' },
    asleep:    { bodyTop: '#64748b', bodyBot: '#334155', halo: 'rgba(100, 116, 139, 0.15)' }
  };

  // Mouse Tracking
  window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.targetX = e.clientX - rect.left;
    mouse.targetY = e.clientY - rect.top;
  });

  // Poke Click on Canvas
  canvas.addEventListener('click', (e) => {
    triggerPoke();
  });

  function triggerPoke() {
    squish.x = 1.35;
    squish.y = 0.7;
    fetch('/api/poke', { method: 'POST' }).catch(() => {});
  }

  // Draw Rounded Squircle with Ear Nubs
  function drawPipBody(cx, cy, width, height, theme) {
    const w = width * squish.x;
    const h = height * squish.y;
    const r = w * 0.42;

    ctx.save();
    ctx.translate(cx, cy + floatOffset);

    if (currentMood === 'dizzy') {
      ctx.rotate(Math.sin(dizzyAngle) * 0.12);
    }

    // Outer glow / aura when needs_you
    if (currentMood === 'needs_you') {
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 24 + Math.sin(Date.now() / 150) * 8;
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 12;
    }

    // Gradient fill
    const grad = ctx.createLinearGradient(0, -h/2, 0, h/2);
    grad.addColorStop(0, theme.bodyTop);
    grad.addColorStop(1, theme.bodyBot);
    ctx.fillStyle = grad;

    // Body Path
    ctx.beginPath();
    ctx.roundRect(-w/2, -h/2, w, h, [r, r, r * 0.9, r * 0.9]);
    ctx.fill();

    // Subtle Left Ear nub
    ctx.beginPath();
    ctx.arc(-w * 0.32, -h * 0.45, w * 0.14, 0, Math.PI * 2);
    ctx.fill();

    // Subtle Right Ear nub
    ctx.beginPath();
    ctx.arc(w * 0.32, -h * 0.45, w * 0.14, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }


  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const theme = MOOD_THEMES[currentMood] || MOOD_THEMES.idle;
    drawPipBody(180, 180, 150, 140, theme);
    requestAnimationFrame(animate);
  }
  animate();
})();
