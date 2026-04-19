import { Scribe, RealtimeEvents, CommitStrategy } from 'https://esm.sh/@elevenlabs/client@0.11.2';

const els = {
  start: document.getElementById('start'),
  stop: document.getElementById('stop'),
  reset: document.getElementById('reset'),
  status: document.getElementById('status'),
  live: document.getElementById('live'),
  transcripts: document.getElementById('transcripts'),
};

let connection = null;
let shouldFinalizeOnClose = false;
const DEBUG = new URLSearchParams(window.location.search).get('debug') === '1';

function debugLog(event, data) {
  if (!DEBUG) return;
  try {
    console.log(`[glancescribe] ${event}`, data ?? '');
  } catch {
    // ignore
  }
}

function setStatus(s) {
  els.status.textContent = s;
}

async function fetchToken() {
  debugLog('token.fetch.start');
  const r = await fetch('/scribe-token');
  if (!r.ok) throw new Error(await r.text());
  const { token } = await r.json();
  if (!token) throw new Error('No token received');
  debugLog('token.fetch.ok');
  return token;
}

function pickSpeakerId(words) {
  const counts = new Map();
  for (const w of words ?? []) {
    if (!w || w.type !== 'word') continue;
    if (!w.speaker_id) continue;
    counts.set(w.speaker_id, (counts.get(w.speaker_id) ?? 0) + 1);
  }
  let best = null;
  let bestCount = -1;
  for (const [k, v] of counts.entries()) {
    if (v > bestCount) {
      best = k;
      bestCount = v;
    }
  }
  return best ?? 'unknown';
}

async function appendLine(line) {
  debugLog('append.start', { len: line.length });
  const r = await fetch('/append', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ line }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(text || `Append failed (${r.status})`);
  }
  const data = await r.json().catch(() => null);
  if (data?.bytes != null) {
    setStatus(`Recording (saved ${data.bytes} bytes to data/transcript.txt)`);
  }
  debugLog('append.ok', data);
}

function addCommittedLine(text) {
  const p = document.createElement('p');
  p.textContent = text;
  els.transcripts.prepend(p);
}

async function start() {
  els.start.disabled = true;
  els.stop.disabled = false;
  setStatus('Requesting token…');
  debugLog('recording.start.clicked');

  const token = await fetchToken();
  setStatus('Connecting…');
  debugLog('scribe.connect.start');

  connection = Scribe.connect({
    token,
    modelId: 'scribe_v2_realtime',
    includeTimestamps: true,
    commitStrategy: CommitStrategy.VAD,
    microphone: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  connection.on(RealtimeEvents.SESSION_STARTED, (data) => {
    setStatus(`Recording (session ${data.session_id})`);
    debugLog('scribe.session_started', data);
  });

  connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {
    els.live.textContent = data.text ?? '';
    debugLog('scribe.partial', { len: (data.text ?? '').length });
  });

  connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS, async (data) => {
    const speaker = pickSpeakerId(data.words);
    const text = (data.text ?? '').trim();
    if (!text) return;

    els.live.textContent = '';
    const ts = new Date().toISOString();
    const line = `[${ts}] [${speaker}] ${text}`;
    addCommittedLine(line);
    debugLog('scribe.committed', { speaker, len: text.length });

    try {
      await appendLine(line);
    } catch (e) {
      setStatus('Recording (failed to write transcript.txt — check server logs)');
      debugLog('append.failed', { error: e?.message ?? String(e) });
    }
  });

  connection.on(RealtimeEvents.ERROR, (err) => {
    console.error(err);
    setStatus('Error (see console)');
    debugLog('scribe.error', err);
  });

  connection.on(RealtimeEvents.CLOSE, () => {
    setStatus('Stopped');
    els.start.disabled = false;
    els.stop.disabled = true;
    connection = null;
    debugLog('scribe.closed');

    if (shouldFinalizeOnClose) {
      shouldFinalizeOnClose = false;
      finalizeSoap().catch((e) => {
        console.error(e);
        setStatus(`Finalize failed: ${e?.message ?? String(e)}`);
        debugLog('finalize.failed', { error: e?.message ?? String(e) });
      });
    }
  });
}

function stop() {
  if (connection) {
    shouldFinalizeOnClose = true;
    setStatus('Stopping…');
    debugLog('recording.stop.clicked');
    // Best-effort: force a final commit so short tests still get written.
    try {
      connection.commit?.();
    } catch {}
    connection.close();
  }
}

async function finalizeSoap() {
  setStatus('Generating SOAP JSON…');
  debugLog('finalize.start');
  const r = await fetch('/finalize', { method: 'POST' });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Finalize failed');
  }
  if (data?.fallback) {
    const hint =
      data.quotaExceeded
        ? 'Gemini quota/rate limit — fallback SOAP saved. Fix billing/quota, then try again.'
        : 'Gemini could not structure the note — fallback SOAP saved. See meta.data_quality.notes in data/soap.json.';
    setStatus(hint);
  } else {
    setStatus('SOAP JSON saved to data/soap.json (download: /soap)');
  }
  debugLog('finalize.ok', data);
}

async function reset() {
  await fetch('/reset', { method: 'POST' });
  els.transcripts.innerHTML = '';
  els.live.textContent = '';
  shouldFinalizeOnClose = false;
  setStatus('Idle');
}

els.start.addEventListener('click', () => start().catch((e) => {
  console.error(e);
  setStatus(`Failed to start: ${e?.message ?? String(e)}`);
  els.start.disabled = false;
  els.stop.disabled = true;
}));
els.stop.addEventListener('click', stop);
els.reset.addEventListener('click', () => reset().catch(console.error));

