(function() {
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function safeHttpUrl(u) {
    try {
      const x = new URL(String(u), window.location.origin);
      return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : '';
    } catch {
      return '';
    }
  }

  const style = document.createElement('style');
  style.textContent = `
    :root { --gs-chat-margin: 16px; --gs-chat-gap: 10px; }
    #gs-chat-btn {
      position: fixed; z-index: 9999;
      width: 52px; height: 52px; border-radius: 50%;
      background: #0d9488; border: 1px solid rgba(240,240,240,0.16); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow:
        0 0 0 2px rgba(13,148,136,0.28),
        0 0 32px rgba(13,148,136,0.6),
        0 0 56px rgba(13,148,136,0.35);
      /* Important: DO NOT animate top/left while dragging */
      transition: transform 450ms ease-in-out, box-shadow 450ms ease-in-out, background 450ms ease-in-out, border-color 450ms ease-in-out;
      touch-action: none;
    }
    #gs-chat-btn:hover {
      background: linear-gradient(0deg, rgba(13,148,136,0.95), rgba(34,199,184,0.85));
      box-shadow:
        inset 0px 1px 0px 0px rgba(240,240,240,0.16),
        inset 0px -4px 0px 0px rgba(0,0,0,0.22),
        0px 0px 0px 4px rgba(13,148,136,0.28),
        0px 0px 48px rgba(13,148,136,0.85),
        0px 0px 100px rgba(13,148,136,0.45);
      transform: translateY(-2px) scale(1.02);
    }
    #gs-chat-btn svg { width: 24px; height: 24px; fill: white; pointer-events: none; }
    #gs-chat-btn * { pointer-events: none; }
    #gs-chat-panel {
      position: fixed; z-index: 9998;
      width: 360px; height: 520px;
      background: #090e0e; border: 1px solid rgba(240,240,240,0.14);
      border-radius: 16px; display: flex; flex-direction: column;
      overflow: hidden;
      transform-origin: bottom center;
      transition: transform 0.2s, opacity 0.2s;
      font-family: 'Helvetica Neue', sans-serif;
    }
    #gs-chat-panel[data-gs-placement="below"] { transform-origin: top center; }
    #gs-chat-panel:not(.open) {
      opacity: 0; pointer-events: none;
      transform: scale(0.94) translateY(6px);
    }
    #gs-chat-panel:not(.open)[data-gs-placement="below"] {
      transform: scale(0.94) translateY(-6px);
    }
    #gs-chat-panel.open { transform: scale(1) translateY(0); opacity: 1; pointer-events: all; }
    #gs-chat-header {
      padding: 14px 16px; border-bottom: 1px solid #2a2a30;
      display: flex; align-items: center; gap: 10px;
      cursor: grab;
      user-select: none;
      touch-action: none;
    }
    body.gs-chat-dragging, body.gs-chat-dragging * { cursor: grabbing !important; user-select: none !important; }
    body.gs-chat-dragging #gs-chat-btn { transition: none !important; transform: none !important; }
    body.gs-chat-dragging #gs-chat-panel { transition: none !important; }
    #gs-chat-header .avatar {
      width: 32px; height: 32px; border-radius: 50%;
      background: #0d9488; display: flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 600; color: white;
    }
    #gs-chat-header .title { font-size: 14px; font-weight: 600; color: #f0f0f0; }
    #gs-chat-header .sub { font-size: 11px; color: #4a6060; }
    #gs-chat-messages {
      flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px;
    }
    #gs-chat-messages::-webkit-scrollbar { width: 4px; }
    #gs-chat-messages::-webkit-scrollbar-track { background: transparent; }
    #gs-chat-messages::-webkit-scrollbar-thumb { background: #2a2a30; border-radius: 4px; }
    .gs-msg { max-width: 85%; display: flex; flex-direction: column; gap: 4px; }
    .gs-msg.ai { align-self: flex-start; }
    .gs-msg.me { align-self: flex-end; }
    .gs-msg .bubble {
      padding: 10px 13px; border-radius: 12px; font-size: 13px; line-height: 1.5;
    }
    .gs-msg.ai .bubble { background: #0b1414; color: #f0f0f0; border: 1px solid rgba(240,240,240,0.10); border-radius: 4px 12px 12px 12px; }
    .gs-msg.me .bubble { background: #0d9488; color: white; border-radius: 12px 4px 12px 12px; box-shadow: 0 0 18px rgba(13,148,136,0.35); }
    .gs-msg .sources { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
    .gs-msg .source-link {
      font-size: 11px; color: #0d9488; text-decoration: none;
      background: #0b1414; padding: 4px 8px; border-radius: 6px;
      border: 1px solid rgba(240,240,240,0.10); display: block; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
    }
    .gs-msg .source-link:hover { color: #22c7b8; box-shadow: 0 0 18px rgba(13,148,136,0.35); }
    .gs-typing { display: flex; gap: 4px; align-items: center; padding: 10px 13px;
      background: #1e1e28; border-radius: 4px 12px 12px 12px; width: fit-content; }
    .gs-typing span { width: 6px; height: 6px; border-radius: 50%; background: #555;
      animation: gs-bounce 1.2s infinite; }
    .gs-typing span:nth-child(2) { animation-delay: 0.2s; }
    .gs-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes gs-bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-6px); background: #0d9488; } }
    #gs-chat-input-row {
      padding: 12px; border-top: 1px solid #2a2a30;
      display: flex; gap: 8px; align-items: center;
    }
    #gs-chat-input {
      flex: 1; background: #0b1414; border: 1px solid rgba(240,240,240,0.14); border-radius: 10px;
      padding: 10px 13px; color: #f0f0f0; font-size: 13px; outline: none;
      font-family: inherit; resize: none; height: 40px; line-height: 1.4;
    }
    #gs-chat-input:focus { border-color: #0d9488; box-shadow: 0 0 0 2px rgba(13,148,136,0.18), 0 0 18px rgba(13,148,136,0.40); }
    #gs-chat-input::placeholder { color: #4a6060; }
    #gs-send-btn {
      width: 36px; height: 36px; border-radius: 10px; background: #0d9488;
      border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: background 0.15s;
    }
    #gs-send-btn:hover {
      background: linear-gradient(0deg, rgba(13,148,136,0.95), rgba(34,199,184,0.85));
      box-shadow:
        inset 0px 1px 0px 0px rgba(240,240,240,0.16),
        inset 0px -4px 0px 0px rgba(0,0,0,0.22),
        0px 0px 0px 3px rgba(13,148,136,0.14),
        0px 0px 60px 0px rgba(13,148,136,0.70);
      transform: translateY(-1px);
    }
    #gs-send-btn:disabled { opacity: 0.4; cursor: default; }
    #gs-send-btn svg { width: 16px; height: 16px; fill: white; }
  `;
  document.head.appendChild(style);

  document.body.insertAdjacentHTML('beforeend', `
    <button id="gs-chat-btn" onclick="gsToggleChat()" title="Medical AI Assistant">
      <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 10H6V10h12v2zm0-3H6V7h12v2z"/></svg>
    </button>
    <div id="gs-chat-panel" data-gs-placement="above">
      <div id="gs-chat-header">
        <div class="avatar">AI</div>
        <div><div class="title">Medical Assistant</div><div class="sub">Powered by verified sources</div></div>
      </div>
      <div id="gs-chat-messages">
        <div class="gs-msg ai"><div class="bubble">Hi! Ask me anything — drug dosages, symptoms, treatments, clinical guidelines. I'll search verified medical sources.</div></div>
      </div>
      <div id="gs-chat-input-row">
        <input id="gs-chat-input" placeholder="Ask a medical question..." onkeydown="if(event.key==='Enter')gsSend()" />
        <button id="gs-send-btn" onclick="gsSend()">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    </div>
  `);

  const BTN_SIZE = 52;
  const PANEL_W = 360;
  const PANEL_H = 520;
  const MARGIN = 16;
  const GAP = 10;
  const STORAGE_KEY = 'gs_chat_pos_v2';

  const btn = document.getElementById('gs-chat-btn');
  const panel = document.getElementById('gs-chat-panel');
  const header = document.getElementById('gs-chat-header');

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function snapSideFor(left) {
    const cx = left + BTN_SIZE / 2;
    const vw = window.innerWidth;
    return cx < vw / 2 ? 'left' : 'right';
  }

  function edgeX(side) {
    const vw = window.innerWidth;
    return side === 'left' ? MARGIN : Math.max(MARGIN, vw - BTN_SIZE - MARGIN);
  }

  function topPctFor(top) {
    const vh = window.innerHeight;
    const travel = Math.max(1, vh - BTN_SIZE - 2 * MARGIN);
    return clamp((top - MARGIN) / travel, 0, 1);
  }

  function topFromPct(pct) {
    const vh = window.innerHeight;
    const travel = Math.max(0, vh - BTN_SIZE - 2 * MARGIN);
    return MARGIN + clamp(pct, 0, 1) * travel;
  }

  function setBtnPos(left, top) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const l = clamp(left, MARGIN, Math.max(MARGIN, vw - BTN_SIZE - MARGIN));
    const t = clamp(top, MARGIN, Math.max(MARGIN, vh - BTN_SIZE - MARGIN));
    btn.style.left = `${l}px`;
    btn.style.top = `${t}px`;
    btn.style.right = '';
    btn.style.bottom = '';
    updatePanelPos(l, t);
  }

  function updatePanelPos(btnLeft, btnTop) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const preferredTop = btnTop - GAP - PANEL_H;
    const belowTop = btnTop + BTN_SIZE + GAP;
    const placeAbove = preferredTop >= MARGIN;
    let top = placeAbove ? preferredTop : belowTop;
    panel.dataset.gsPlacement = placeAbove ? 'above' : 'below';

    // Horizontally center the panel on the bubble (clamped to viewport).
    const btnCenterX = btnLeft + BTN_SIZE / 2;
    let left = btnCenterX - PANEL_W / 2;
    left = clamp(left, MARGIN, Math.max(MARGIN, vw - PANEL_W - MARGIN));

    const clampedTop = clamp(top, MARGIN, Math.max(MARGIN, vh - PANEL_H - MARGIN));
    panel.style.left = `${left}px`;
    panel.style.top = `${clampedTop}px`;
    panel.style.right = '';
    panel.style.bottom = '';
  }

  function restorePosition() {
    // New format: { side: "left"|"right", topPct: number }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const side = parsed?.side === 'left' || parsed?.side === 'right' ? parsed.side : 'right';
        const pct = Number.isFinite(parsed?.topPct) ? parsed.topPct : 1;
        setBtnPos(edgeX(side), topFromPct(pct));
        return;
      }
    } catch {}

    // Back-compat: old 4-corner key (if present)
    const old = localStorage.getItem('gs_chat_corner_v1');
    if (old === 'tl') return setBtnPos(edgeX('left'), MARGIN);
    if (old === 'tr') return setBtnPos(edgeX('right'), MARGIN);
    if (old === 'bl') return setBtnPos(edgeX('left'), topFromPct(1));
    // 'br' or default
    setBtnPos(edgeX('right'), topFromPct(1));
  }

  restorePosition();
  window.addEventListener('resize', () => {
    // Keep it on-screen and re-align the panel.
    const left = Number.parseFloat(btn.style.left || '0') || 0;
    const top = Number.parseFloat(btn.style.top || '0') || 0;
    setBtnPos(left, top);
  });

  window.gsToggleChat = function() {
    if (suppressNextToggle) {
      suppressNextToggle = false;
      return;
    }
    const left = Number.parseFloat(btn.style.left || '0') || 0;
    const top = Number.parseFloat(btn.style.top || '0') || 0;
    updatePanelPos(left, top);
    panel.classList.toggle('open');
  };

  // ─── Drag to reposition (snap to nearest corner) ───────────────────────────
  let dragging = false;
  let dragStart = { x: 0, y: 0, left: 0, top: 0 };
  let dragMoved = false;
  let suppressNextToggle = false;
  const DRAG_THRESHOLD_PX = 6;

  function startDrag(e) {
    // Allow button always; allow header only when panel is open.
    if (e.target === header && !panel.classList.contains('open')) return;
    // Don’t start drag from interactive controls inside the panel.
    const interactive = e.target.closest && e.target.closest('input, textarea, button, a');
    if (interactive && e.target !== btn) return;

    dragging = true;
    dragMoved = false;
    document.body.classList.add('gs-chat-dragging');

    const left = Number.parseFloat(btn.style.left || '0') || 0;
    const top = Number.parseFloat(btn.style.top || '0') || 0;
    dragStart = { x: e.clientX, y: e.clientY, left, top };

    try { (e.currentTarget || btn).setPointerCapture?.(e.pointerId); } catch {}
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!dragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (!dragMoved && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
      dragMoved = true;
    }
    setBtnPos(dragStart.left + dx, dragStart.top + dy);
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('gs-chat-dragging');
    if (dragMoved) {
      // Prevent the synthetic click after dragging from toggling the panel.
      suppressNextToggle = true;
      setTimeout(() => { suppressNextToggle = false; }, 250);
    }

    const left = Number.parseFloat(btn.style.left || '0') || 0;
    const top = Number.parseFloat(btn.style.top || '0') || 0;
    const side = snapSideFor(left);
    const snappedLeft = edgeX(side);
    const snappedTop = clamp(top, MARGIN, Math.max(MARGIN, window.innerHeight - BTN_SIZE - MARGIN));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ side, topPct: topPctFor(snappedTop) }));
    setBtnPos(snappedLeft, snappedTop);
  }

  // Use capture so inner elements never “steal” the press.
  btn.addEventListener('pointerdown', startDrag, { capture: true });
  header.addEventListener('pointerdown', startDrag);
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  window.gsSend = async function() {
    const input = document.getElementById('gs-chat-input');
    const query = input.value.trim();
    if (!query) return;

    const messages = document.getElementById('gs-chat-messages');
    const sendBtn = document.getElementById('gs-send-btn');

    messages.insertAdjacentHTML('beforeend', `<div class="gs-msg me"><div class="bubble">${esc(query)}</div></div>`);
    input.value = '';
    sendBtn.disabled = true;

    const typing = document.createElement('div');
    typing.className = 'gs-msg ai';
    typing.innerHTML = '<div class="gs-typing"><span></span><span></span><span></span></div>';
    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const data = await res.json().catch(() => ({}));
      typing.remove();

      if (!res.ok) {
        const errText = typeof data.error === 'string' ? data.error : `Request failed (${res.status})`;
        messages.insertAdjacentHTML('beforeend', `<div class="gs-msg ai"><div class="bubble">${esc(errText)}</div></div>`);
        sendBtn.disabled = false;
        messages.scrollTop = messages.scrollHeight;
        return;
      }

      let sourcesHTML = '';
      if (data.sources && data.sources.length > 0) {
        sourcesHTML = '<div class="sources">' + data.sources.map((s) => {
          const href = safeHttpUrl(s.url);
          if (!href) return '';
          return `<a class="source-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">↗ ${esc(s.title)}</a>`;
        }).filter(Boolean).join('') + '</div>';
      }

      const answerText = data.answer || 'No answer found. Try rephrasing your question.';
      messages.insertAdjacentHTML('beforeend', `
        <div class="gs-msg ai">
          <div class="bubble">${esc(answerText)}</div>
          ${sourcesHTML}
        </div>
      `);
    } catch(e) {
      typing.remove();
      messages.insertAdjacentHTML('beforeend', `<div class="gs-msg ai"><div class="bubble">Search failed. Make sure the server is running.</div></div>`);
    }

    sendBtn.disabled = false;
    messages.scrollTop = messages.scrollHeight;
  };
})();
