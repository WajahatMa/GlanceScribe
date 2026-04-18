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
    #gs-chat-btn {
      position: fixed; bottom: 28px; right: 28px; z-index: 9999;
      width: 52px; height: 52px; border-radius: 50%;
      background: #7c3aed; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 20px rgba(124,58,237,0.4);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    #gs-chat-btn:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(124,58,237,0.5); }
    #gs-chat-btn svg { width: 24px; height: 24px; fill: white; }
    #gs-chat-panel {
      position: fixed; bottom: 90px; right: 28px; z-index: 9998;
      width: 360px; height: 520px;
      background: #0f0f12; border: 1px solid #2a2a30;
      border-radius: 16px; display: flex; flex-direction: column;
      overflow: hidden; transform: scale(0.95) translateY(10px);
      opacity: 0; pointer-events: none;
      transition: transform 0.2s, opacity 0.2s;
      font-family: 'Helvetica Neue', sans-serif;
    }
    #gs-chat-panel.open { transform: scale(1) translateY(0); opacity: 1; pointer-events: all; }
    #gs-chat-header {
      padding: 14px 16px; border-bottom: 1px solid #2a2a30;
      display: flex; align-items: center; gap: 10px;
    }
    #gs-chat-header .avatar {
      width: 32px; height: 32px; border-radius: 50%;
      background: #7c3aed; display: flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 600; color: white;
    }
    #gs-chat-header .title { font-size: 14px; font-weight: 500; color: #f0f0f0; }
    #gs-chat-header .sub { font-size: 11px; color: #666; }
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
    .gs-msg.ai .bubble { background: #1e1e28; color: #d0d0e0; border-radius: 4px 12px 12px 12px; }
    .gs-msg.me .bubble { background: #7c3aed; color: white; border-radius: 12px 4px 12px 12px; }
    .gs-msg .sources { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
    .gs-msg .source-link {
      font-size: 11px; color: #7c3aed; text-decoration: none;
      background: #1a1a28; padding: 4px 8px; border-radius: 6px;
      border: 1px solid #2a2a40; display: block; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
    }
    .gs-msg .source-link:hover { color: #a78bfa; }
    .gs-typing { display: flex; gap: 4px; align-items: center; padding: 10px 13px;
      background: #1e1e28; border-radius: 4px 12px 12px 12px; width: fit-content; }
    .gs-typing span { width: 6px; height: 6px; border-radius: 50%; background: #555;
      animation: gs-bounce 1.2s infinite; }
    .gs-typing span:nth-child(2) { animation-delay: 0.2s; }
    .gs-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes gs-bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-6px); background: #7c3aed; } }
    #gs-chat-input-row {
      padding: 12px; border-top: 1px solid #2a2a30;
      display: flex; gap: 8px; align-items: center;
    }
    #gs-chat-input {
      flex: 1; background: #1a1a22; border: 1px solid #2a2a30; border-radius: 10px;
      padding: 10px 13px; color: #f0f0f0; font-size: 13px; outline: none;
      font-family: inherit; resize: none; height: 40px; line-height: 1.4;
    }
    #gs-chat-input:focus { border-color: #7c3aed; }
    #gs-chat-input::placeholder { color: #444; }
    #gs-send-btn {
      width: 36px; height: 36px; border-radius: 10px; background: #7c3aed;
      border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: background 0.15s;
    }
    #gs-send-btn:hover { background: #6d28d9; }
    #gs-send-btn:disabled { opacity: 0.4; cursor: default; }
    #gs-send-btn svg { width: 16px; height: 16px; fill: white; }
  `;
  document.head.appendChild(style);

  document.body.insertAdjacentHTML('beforeend', `
    <button id="gs-chat-btn" onclick="gsToggleChat()" title="Medical AI Assistant">
      <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 10H6V10h12v2zm0-3H6V7h12v2z"/></svg>
    </button>
    <div id="gs-chat-panel">
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

  window.gsToggleChat = function() {
    document.getElementById('gs-chat-panel').classList.toggle('open');
  };

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
