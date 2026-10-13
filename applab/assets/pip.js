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

  // Draw Eyes & Expressions
  function drawPipFace(cx, cy, theme) {
    ctx.save();
    ctx.translate(cx, cy + floatOffset);

    if (currentMood === 'dizzy') {
      ctx.rotate(Math.sin(dizzyAngle) * 0.12);
    }

    const eyeSpacing = 42 * squish.x;
    const eyeY = -10 * squish.y;
    const eyeRadius = 18;

    // Normalized pupil tracking relative to center
    const dx = (mouse.x - cx) / 180;
    const dy = (mouse.y - cy) / 180;
    const pupilX = Math.max(-1, Math.min(1, dx)) * 7;
    const pupilY = Math.max(-1, Math.min(1, dy)) * 6;

    // 1. HAPPY EYES (^ ^)
    if (currentMood === 'happy') {
      ctx.strokeStyle = '#052e16';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';

      // Left eye arc
      ctx.beginPath();
      ctx.arc(-eyeSpacing, eyeY, 14, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();

      // Right eye arc
      ctx.beginPath();
      ctx.arc(eyeSpacing, eyeY, 14, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();

      // Cheerful Smile
      ctx.beginPath();
      ctx.arc(0, eyeY + 18, 12, 0.1, Math.PI - 0.1);
      ctx.stroke();

    // 2. ASLEEP EYES (- - with Zs)
    } else if (currentMood === 'asleep') {
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.moveTo(-eyeSpacing - 12, eyeY);
      ctx.lineTo(-eyeSpacing + 12, eyeY);
      ctx.moveTo(eyeSpacing - 12, eyeY);
      ctx.lineTo(eyeSpacing + 12, eyeY);
      ctx.stroke();

      // Floating Z
      const zOffset = (Date.now() / 40) % 60;
      ctx.font = '700 16px monospace';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillText('z', eyeSpacing + 22, eyeY - zOffset * 0.5);
      ctx.font = '700 22px monospace';
      ctx.fillText('Z', eyeSpacing + 32, eyeY - 20 - zOffset * 0.8);

    // 3. ANNOYED EYES (straight narrow brows)
    } else if (currentMood === 'annoyed') {
      ctx.fillStyle = '#450a0a';
      ctx.beginPath();
      ctx.ellipse(-eyeSpacing, eyeY, eyeRadius * 0.9, 6, 0, 0, Math.PI * 2);
      ctx.ellipse(eyeSpacing, eyeY, eyeRadius * 0.9, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Sulky mouth
      ctx.strokeStyle = '#450a0a';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(-10, eyeY + 24);
      ctx.lineTo(10, eyeY + 22);
      ctx.stroke();

    // 4. DIZZY EYES (Spiral / Spinning crosses)
    } else if (currentMood === 'dizzy') {
      ctx.strokeStyle = '#3b0764';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';

      [-eyeSpacing, eyeSpacing].forEach((ex) => {
        ctx.save();
        ctx.translate(ex, eyeY);
        ctx.rotate(dizzyAngle * 3);
        ctx.beginPath();
        ctx.moveTo(-10, -10); ctx.lineTo(10, 10);
        ctx.moveTo(10, -10); ctx.lineTo(-10, 10);
        ctx.stroke();
        ctx.restore();
      });

      // Wobble mouth
      ctx.beginPath();
      ctx.arc(0, eyeY + 24, 7, 0, Math.PI * 2);
      ctx.stroke();

    // 5. STANDARD / WATCHING / NEEDS_YOU (With Pupil Tracking & Blinking)
    } else {
      const isNeedsYou = currentMood === 'needs_you';
      const isWatching = currentMood === 'watching';
      const currentRadius = isNeedsYou ? eyeRadius * 1.15 : (isWatching ? eyeRadius * 1.05 : eyeRadius);

      [-eyeSpacing, eyeSpacing].forEach((ex) => {
        // Eye White
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        if (blink.isBlinking) {
          ctx.ellipse(ex, eyeY, currentRadius, 2, 0, 0, Math.PI * 2);
        } else {
          ctx.arc(ex, eyeY, currentRadius, 0, Math.PI * 2);
        }
        ctx.fill();

        // Pupil + Iris
        if (!blink.isBlinking) {
          ctx.fillStyle = isNeedsYou ? '#78350f' : '#0f172a';
          ctx.beginPath();
          ctx.arc(ex + pupilX, eyeY + pupilY, currentRadius * 0.58, 0, Math.PI * 2);
          ctx.fill();

          // Cute specular highlight
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(ex + pupilX - 3, eyeY + pupilY - 3, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Cute mouth curve
      ctx.strokeStyle = isNeedsYou ? '#78350f' : '#082f49';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (isNeedsYou) {
        // Open surprised / concerned 'o'
        ctx.ellipse(0, eyeY + 22, 6, 8, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.arc(0, eyeY + 18, 9, 0.2, Math.PI - 0.2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  // Physics & Animation Loop
  function animate() {
    const now = Date.now();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Mouse interpolation
    mouse.x += (mouse.targetX - mouse.x) * 0.15;
    mouse.y += (mouse.targetY - mouse.y) * 0.15;

    // Squish spring physics
    const k = 0.18; // spring tension
    const damp = 0.82; // damping
    squish.vx += (1 - squish.x) * k;
    squish.vy += (1 - squish.y) * k;
    squish.vx *= damp;
    squish.vy *= damp;
    squish.x += squish.vx;
    squish.y += squish.vy;

    // Blinking timer
    if (!blink.isBlinking && now > blink.nextTime) {
      blink.isBlinking = true;
      blink.nextTime = now + 160; // blink duration
    } else if (blink.isBlinking && now > blink.nextTime) {
      blink.isBlinking = false;
      blink.nextTime = now + 2500 + Math.random() * 4000;
    }

    // Mood animations
    if (currentMood === 'dizzy') {
      dizzyAngle += 0.08;
    }
    if (currentMood === 'happy') {
      floatOffset = -Math.abs(Math.sin(now / 180) * 16);
    } else {
      floatOffset = Math.sin(now / 500) * 6;
    }

    const theme = MOOD_THEMES[currentMood] || MOOD_THEMES.idle;
    halo.style.background = `radial-gradient(circle, ${theme.halo} 0%, transparent 70%)`;

    // Render Pip
    drawPipBody(180, 180, 150, 140, theme);
    drawPipFace(180, 180, theme);

    requestAnimationFrame(animate);
  }

  // Update DOM Status
  function updateUI(status) {
    if (!status) return;
    currentMood = status.mood || 'idle';
    activeRequest = status.active_request;
    isPaired = !!status.paired;

    moodBadge.textContent = currentMood;
    moodBadge.className = `mood-badge mood-${currentMood}`;
    oneLiner.textContent = status.one_liner || 'Pip is standing by';

    // Bridge Status
    if (status.has_bridge) {
      bridgePill.className = 'pill status-pill active';
      bridgePill.querySelector('.pill-text').textContent = 'LED Matrix: Linked';
    } else {
      bridgePill.className = 'pill status-pill';
      bridgePill.querySelector('.pill-text').textContent = 'LED Matrix: Standalone';
    }

    // Pair Status
    if (isPaired) {
      pairPill.className = 'pill status-pill active';
      pairStatusText.textContent = 'Laptop Paired';
    } else {
      pairPill.className = 'pill status-pill warning';
      pairStatusText.textContent = 'Unpaired';
    }

    // Approval Card
    if (activeRequest) {
      approvalCard.classList.remove('hidden');
      approvalAgent.textContent = (activeRequest.agent || 'AGENT').toUpperCase();
      approvalSummary.textContent = activeRequest.summary || 'Approval Requested';
      approvalCommand.textContent = activeRequest.command || '';
    } else {
      approvalCard.classList.add('hidden');
    }
  }

  // SSE Real-Time Sync
  function initSSE() {
    const evtSource = new EventSource('/api/stream');
    evtSource.onmessage = function(e) {
      try {
        const data = JSON.parse(e.data);
        if (data.status) {
          updateUI(data.status);
        }
      } catch (err) {}
    };
    evtSource.onerror = function() {
      evtSource.close();
      setTimeout(initSSE, 3000); // Reconnect
    };
  }

  // Fallback Poller
  function pollStatus() {
    fetch('/api/status')
      .then(res => res.json())
      .then(updateUI)
      .catch(() => {});
  }

  // Event Handlers
  btnAllow.addEventListener('click', () => {
    if (!activeRequest) return;
    fetch('/api/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: activeRequest.request_id, decision: 'allow', source: 'web_ui' })
    }).catch(() => {});
  });

  btnDeny.addEventListener('click', () => {
    if (!activeRequest) return;
    fetch('/api/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: activeRequest.request_id, decision: 'deny', source: 'web_ui' })
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
    if (!chatSection.classList.contains('collapsed')) {
      chatInput.focus();
    }
  });

  btnCloseChat.addEventListener('click', () => {
    chatSection.classList.add('collapsed');
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (!msg) return;

    // Append user message
    appendChatMsg('You', msg, 'user-msg');
    chatInput.value = '';

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    })
    .then(r => r.json())
    .then(data => {
      appendChatMsg('Pip', data.reply, 'pip-msg');
    })
    .catch(() => {
      appendChatMsg('Pip', 'Oops, brain hiccup! Still watching your agents though! ◉‿◉', 'pip-msg');
    });
  });

  function appendChatMsg(sender, text, className) {
    const div = document.createElement('div');
    div.className = `msg ${className}`;
    div.innerHTML = `<div class="sender">${sender}</div><div class="bubble">${escapeHtml(text)}</div>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // Pairing Modal
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
    .then(r => r.json())
    .then(() => {
      pairModal.classList.add('hidden');
      pollStatus();
    });
  });

  btnUnpair.addEventListener('click', () => {
    fetch('/api/unpair', { method: 'POST' }).then(() => {
      pairModal.classList.add('hidden');
      pollStatus();
    });
  });

  // Start Engine
  pollStatus();
  initSSE();
  animate();
})();
