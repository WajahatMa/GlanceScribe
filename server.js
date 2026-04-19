import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { GoogleGenerativeAI } from '@google/generative-ai';
import multer from 'multer';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { Readable } from 'node:stream';

const execAsync = promisify(exec);

/**
 * GlassesStream serves an HTML viewer at `/` and the live MJPEG feed at `/stream`.
 * If GLASSES_STREAM_URL is the viewer root, proxy `/stream` so the browser gets frames, not HTML.
 */
function resolveGlassesStreamUrl(raw) {
  const u = (raw || '').trim();
  if (!u) return '';
  try {
    const parsed = new URL(u);
    const pathOnly = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
    if (pathOnly === '/') {
      parsed.pathname = '/stream';
      return parsed.href;
    }
    return u;
  } catch {
    return u;
  }
}

const _rawGlassesUrl = (process.env.GLASSES_STREAM_URL || '').trim();
const GLASSES_STREAM_URL = resolveGlassesStreamUrl(_rawGlassesUrl);
if (_rawGlassesUrl) {
  console.log('🕶  Glasses video proxy →', GLASSES_STREAM_URL);
  if (GLASSES_STREAM_URL !== _rawGlassesUrl) {
    console.log('   (viewer URL was normalized to /stream for MJPEG)');
  }
}

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 5179;

// ─── Video storage path (create if needed) ───────────────────────────────────
const VIDEO_DIR = process.env.VIDEO_DIR
  ? path.resolve(process.env.VIDEO_DIR)
  : path.join(process.cwd(), 'videos');

await fs.mkdir(VIDEO_DIR, { recursive: true });
await fs.mkdir(path.join(process.cwd(), 'data'), { recursive: true });

// Serve recorded videos (and highlights) to the dashboard.
app.use('/videos', express.static(VIDEO_DIR, {
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store');
  },
}));

// ─── Multer for video chunk uploads ──────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// ─── In-memory session state ──────────────────────────────────────────────────
let currentSession = null;

// ─── SSE clients for live transcript push ────────────────────────────────────
let sseClients = [];

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(process.cwd(), 'public')));

// Medical assistant chat (Tavily search — same idea as chatbox branch)
app.post('/api/search', async (req, res, next) => {
  try {
    const { query } = req.body ?? {};
    if (typeof query !== 'string' || !query.trim()) {
      res.status(400).json({ error: 'No query' });
      return;
    }
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: 'TAVILY_API_KEY not set — add it to .env to enable the medical chat search.',
      });
      return;
    }
    const tavilyRes = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: `${query.trim()} medical clinical`,
        search_depth: 'advanced',
        include_answer: true,
        include_domains: [
          'pubmed.ncbi.nlm.nih.gov', 'mayoclinic.org', 'medscape.com', 'nih.gov', 'who.int',
          'uptodate.com', 'nejm.org', 'bmj.com', 'cdc.gov',
        ],
        max_results: 3,
      }),
    });
    const rawText = await tavilyRes.text();
    if (!tavilyRes.ok) {
      res.status(502).json({ error: 'Tavily request failed', details: rawText.slice(0, 300) });
      return;
    }
    const data = JSON.parse(rawText);
    res.json({
      answer: data.answer ?? '',
      sources: data.results?.map((r) => ({ title: r.title, url: r.url })) ?? [],
    });
  } catch (e) {
    next(e);
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    const err = new Error(`Missing required env var: ${name}`);
    err.statusCode = 500;
    throw err;
  }
  return v;
}

function makeSessionId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `session_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function getLocalIP() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch {
    // Some restricted environments can block interface enumeration.
  }
  return 'localhost';
}

// ─── Check ffmpeg availability ────────────────────────────────────────────────
let ffmpegAvailable = false;
try {
  await execAsync('which ffmpeg');
  ffmpegAvailable = true;
  console.log('✅ ffmpeg found — video compression enabled');
} catch {
  console.warn('⚠️  ffmpeg not found — video saved as-is (install: brew install ffmpeg)');
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// Root — serve index.html (iPhone recording page)
app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Recorder UI: whether to use Meta glasses (or any HTTP stream) instead of getUserMedia video
app.get('/api/recorder-config', (req, res) => {
  res.json({
    useGlasses: Boolean(GLASSES_STREAM_URL),
    glassesFeedUrl: GLASSES_STREAM_URL ? '/glasses-feed' : '',
  });
});

// Same-origin proxy so <video>/<img> and captureStream are not blocked by CORS
app.get('/glasses-feed', (req, res) => {
  if (!GLASSES_STREAM_URL) {
    res.status(503).type('text/plain').send('GLASSES_STREAM_URL is not set');
    return;
  }
  const ac = new AbortController();

  fetch(GLASSES_STREAM_URL, { signal: ac.signal, redirect: 'follow' })
    .then((upstream) => {
      if (!upstream.ok) {
        res.status(502).type('text/plain').send(`Upstream HTTP ${upstream.status}`);
        return;
      }
      const ct = upstream.headers.get('content-type');
      if (ct) res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'no-store');
      if (!upstream.body) {
        res.status(502).type('text/plain').send('Empty upstream body');
        return;
      }

      const body = Readable.fromWeb(upstream.body);
      let cleaned = false;
      const stopUpstream = () => {
        if (cleaned) return;
        cleaned = true;
        ac.abort();
        try {
          body.destroy();
        } catch (_) {}
      };

      // Never use req.once('close') here: for GET, IncomingMessage often emits 'close'
      // as soon as headers are read, which would abort the stream immediately and crash Node.
      res.once('close', stopUpstream);
      req.once('aborted', stopUpstream);

      const detach = () => {
        res.removeListener('close', stopUpstream);
        req.removeListener('aborted', stopUpstream);
      };

      body.on('error', () => {
        detach();
        if (!res.writableEnded) {
          try {
            res.destroy();
          } catch (_) {}
        }
      });
      res.on('error', () => {
        detach();
        stopUpstream();
      });

      body.pipe(res);
    })
    .catch((e) => {
      if (res.headersSent) {
        try {
          res.destroy();
        } catch (_) {}
        return;
      }
      const msg = e?.name === 'AbortError' ? 'Client disconnected' : String(e?.message || e);
      res.status(502).type('text/plain').send(msg);
    });
});

// ElevenLabs Scribe token
app.get('/scribe-token', async (req, res, next) => {
  try {
    const apiKey = requireEnv('ELEVENLABS_API_KEY');
    const response = await fetch('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      res.status(502).json({ error: 'Failed to fetch Scribe token', details: text });
      return;
    }
    const data = await response.json();
    res.json({ token: data.token });
  } catch (e) { next(e); }
});

// Start a new recording session
app.post('/session/start', async (req, res, next) => {
  try {
    const id = makeSessionId();
    currentSession = {
      id,
      startTime: Date.now(),
      videoChunks: [],
      transcript: [],
      focusEvents: [],
    };

    const file = path.join(process.cwd(), 'data', 'transcript.txt');
    await fs.writeFile(file, `=== Session: ${id} ===\n`, 'utf8');

    // Notify SSE clients
    broadcastSSE({ type: 'session_start', sessionId: id });

    console.log(`\n🟢 Session started: ${id}`);
    res.json({ ok: true, sessionId: id });
  } catch (e) { next(e); }
});

// Focus events from client-side ML overlay (MoveNet)
app.post('/focus', async (req, res, next) => {
  try {
    const { sessionId, events } = req.body ?? {};
    if (!currentSession || !sessionId || sessionId !== currentSession.id) {
      res.status(409).json({ error: 'No active session or sessionId mismatch' });
      return;
    }
    if (!Array.isArray(events)) {
      res.status(400).json({ error: 'Expected { sessionId, events: [] }' });
      return;
    }
    for (const e of events) {
      if (!e || typeof e !== 'object') continue;
      const t_ms = Number(e.t_ms);
      const label = typeof e.label === 'string' ? e.label : null;
      const keypoint = typeof e.keypoint === 'string' ? e.keypoint : null;
      const rank = Number(e.rank);
      if (!Number.isFinite(t_ms) || t_ms < 0) continue;
      if (!label || !keypoint) continue;
      currentSession.focusEvents.push({
        t_ms: Math.round(t_ms),
        label,
        keypoint,
        rank: Number.isFinite(rank) ? rank : null,
      });
    }
    res.json({ ok: true, total: currentSession.focusEvents.length });
  } catch (e) { next(e); }
});

// Append a transcript line
app.post('/append', async (req, res, next) => {
  try {
    const { line } = req.body ?? {};
    if (typeof line !== 'string' || !line.trim()) {
      res.status(400).json({ error: 'Expected JSON body: { line: string }' });
      return;
    }
    const safeLine = line.replace(/\r?\n/g, ' ').trim();

    if (currentSession) {
      currentSession.transcript.push(safeLine);
    }

    const file = path.join(process.cwd(), 'data', 'transcript.txt');
    await fs.appendFile(file, safeLine + '\n', 'utf8');

    // Push to all SSE dashboard clients
    broadcastSSE({
      type: 'transcript_line',
      line: safeLine,
      totalLines: currentSession?.transcript?.length ?? 0,
    });

    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Receive video chunks from iPhone
app.post('/video/chunk', upload.single('chunk'), async (req, res, next) => {
  try {
    if (!currentSession) {
      res.status(400).json({ error: 'No active session. Call /session/start first.' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No chunk file uploaded' });
      return;
    }
    currentSession.videoChunks.push(req.file.buffer);
    broadcastSSE({ type: 'video_chunk', chunks: currentSession.videoChunks.length });
    res.json({ ok: true, chunks: currentSession.videoChunks.length });
  } catch (e) { next(e); }
});

// Stop session, save video, run Gemini analysis
app.post('/session/stop', async (req, res, next) => {
  try {
    if (!currentSession) {
      res.status(400).json({ error: 'No active session' });
      return;
    }

    const session = currentSession;
    currentSession = null;

    const { id, transcript, videoChunks, focusEvents } = session;
    const duration = Math.round((Date.now() - session.startTime) / 1000);

    console.log(`\n🔴 Session stopping: ${id}`);
    console.log(`   Duration: ${duration}s | Transcript lines: ${transcript.length} | Video chunks: ${videoChunks.length}`);

    broadcastSSE({ type: 'session_stop', sessionId: id, status: 'processing' });

    // ── Save video ─────────────────────────────────────────────────────────────
    let videoPath = null;

    if (videoChunks.length > 0) {
      const rawPath = path.join(VIDEO_DIR, `${id}_raw.webm`);
      const allChunks = Buffer.concat(videoChunks);
      await fs.writeFile(rawPath, allChunks);
      console.log(`   💾 Raw video: ${rawPath} (${(allChunks.length / 1024 / 1024).toFixed(1)} MB)`);

      const shouldCompress = process.env.VIDEO_COMPRESS !== '0';
      if (ffmpegAvailable && shouldCompress) {
        const compressedPath = path.join(VIDEO_DIR, `${id}.mp4`);
        try {
          await execAsync(
            `ffmpeg -i "${rawPath}" -c:v libx264 -crf 23 -preset fast -c:a aac -b:a 128k -movflags +faststart "${compressedPath}" -y`
          );
          await fs.unlink(rawPath).catch(() => {});
          videoPath = compressedPath;
          const stat = await fs.stat(compressedPath);
          console.log(`   🎬 MP4: ${compressedPath} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
        } catch (ffErr) {
          console.warn('   ⚠️  ffmpeg failed, keeping raw:', ffErr.message);
          videoPath = rawPath;
        }
      } else {
        videoPath = rawPath;
      }
    }

    // ── Save final transcript ──────────────────────────────────────────────────
    const transcriptText = transcript.join('\n');
    const transcriptPath = path.join(process.cwd(), 'data', `${id}_transcript.txt`);
    await fs.writeFile(transcriptPath, transcriptText, 'utf8');

    // ── Run Gemini analysis (transcript-only) ─────────────────────────────────
    let patientChart = null;
    let analysisError = null;
    let highlightFilename = null;

    try {
      patientChart = await runGeminiAnalysis(transcriptText, videoPath, id);
      const chartPath = path.join(process.cwd(), 'data', `${id}_chart.json`);
      await fs.writeFile(chartPath, JSON.stringify(patientChart, null, 2), 'utf8');
      console.log(`   📋 Chart saved: ${chartPath}`);
      broadcastSSE({ type: 'chart_ready', sessionId: id, chart: patientChart });
    } catch (gErr) {
      console.error('   ❌ Gemini analysis failed:', gErr.message);
      analysisError = gErr.message;
      broadcastSSE({ type: 'chart_error', sessionId: id, error: analysisError });
    }

    // ── Highlight clip (no Gemini video) ──────────────────────────────────────
    try {
      const bodyKeyword = normalizeBodyProblem(patientChart?.bodyPartProblem);
      const chosen = chooseHighlightEvent(focusEvents, bodyKeyword);
      if (videoPath && chosen?.e) {
        const t0 = Number(chosen.e.t_ms) || 0;
        const t1 = Number(chosen.next?.t_ms);
        const recEndMs = Math.max(0, Math.round(duration * 1000));
        // Lead-in before focus locks; post-roll after next keypoint (you often keep gesturing).
        const HIGHLIGHT_LEAD_MS = 2200;
        const HIGHLIGHT_POST_MS = 8500;
        const HIGHLIGHT_MIN_MS = 14_000;
        const HIGHLIGHT_MAX_MS = 48_000;

        const segmentEndMs = Number.isFinite(t1) ? t1 : recEndMs;
        const idealEndMs = Math.min(recEndMs, segmentEndMs + HIGHLIGHT_POST_MS);
        let clipStartMs = Math.max(0, t0 - HIGHLIGHT_LEAD_MS);
        let durationMs = idealEndMs - clipStartMs;
        durationMs = Math.max(HIGHLIGHT_MIN_MS, Math.min(HIGHLIGHT_MAX_MS, durationMs));
        let clipEndMs = clipStartMs + durationMs;
        if (clipEndMs > recEndMs) {
          clipStartMs = Math.max(0, recEndMs - durationMs);
          clipEndMs = recEndMs;
          durationMs = Math.max(0, clipEndMs - clipStartMs);
        }

        highlightFilename = await writeHighlightClip({
          sourcePath: videoPath,
          sessionId: id,
          startMs: clipStartMs,
          durationMs,
        });
        if (highlightFilename) {
          console.log(`   🎞 Highlight saved: ${path.join(VIDEO_DIR, highlightFilename)}`);
          broadcastSSE({ type: 'highlight_ready', sessionId: id, filename: highlightFilename });
        }
      }
    } catch (hErr) {
      console.warn('   ⚠️ Highlight clip failed:', hErr.message);
    }

    try {
      const soap = await generateSoapFromTranscript(transcriptText);
      const soapPath = path.join(process.cwd(), 'data', 'soap.json');
      await fs.writeFile(soapPath, JSON.stringify(soap, null, 2), 'utf8');
      console.log(`   📄 SOAP saved: ${soapPath}`);
      broadcastSSE({ type: 'soap_ready', sessionId: id });
    } catch (soapErr) {
      console.error('   ❌ SOAP /finalize failed:', soapErr.message);
      broadcastSSE({ type: 'soap_error', sessionId: id, error: soapErr.message });
    }

    res.json({
      ok: true,
      sessionId: id,
      duration,
      videoPath: videoPath ? path.basename(videoPath) : null,
      highlight: highlightFilename,
      transcriptLines: transcript.length,
      patientChart,
      analysisError,
    });

  } catch (e) { next(e); }
});

// Get latest chart
app.get('/chart/latest', async (req, res, next) => {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const files = await fs.readdir(dataDir).catch(() => []);
    const charts = files.filter(f => f.endsWith('_chart.json')).sort().reverse();
    if (charts.length === 0) {
      res.json({ chart: null });
      return;
    }
    const latest = await fs.readFile(path.join(dataDir, charts[0]), 'utf8');
    res.json({ chart: JSON.parse(latest), filename: charts[0] });
  } catch (e) { next(e); }
});

/** Only allow writing chart JSON files under data/ (no path traversal). */
function safeChartFilename(name) {
  const base = path.basename(String(name ?? ''));
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*_chart\.json$/.test(base)) return null;
  return base;
}

// Save edited patient chart (includes plan & treatment)
app.post('/chart/save', async (req, res, next) => {
  try {
    const { filename, chart } = req.body ?? {};
    const safe = safeChartFilename(filename);
    if (!safe || !chart || typeof chart !== 'object') {
      res.status(400).json({ error: 'Expected JSON body: { filename: string, chart: object }' });
      return;
    }
    const out = { ...chart, lastEditedAt: new Date().toISOString() };
    const full = path.join(process.cwd(), 'data', safe);
    await fs.writeFile(full, JSON.stringify(out, null, 2), 'utf8');
    res.json({ ok: true, filename: safe });
  } catch (e) { next(e); }
});

// Save edited SOAP note
app.post('/soap/save', async (req, res, next) => {
  try {
    const { soap } = req.body ?? {};
    if (!soap || typeof soap !== 'object') {
      res.status(400).json({ error: 'Expected JSON body: { soap: object }' });
      return;
    }
    const soapPath = path.join(process.cwd(), 'data', 'soap.json');
    const out = { ...soap, lastEditedAt: new Date().toISOString() };
    await fs.writeFile(soapPath, JSON.stringify(out, null, 2), 'utf8');
    res.json({ ok: true, path: 'data/soap.json' });
  } catch (e) { next(e); }
});

// Get latest highlight clip filename (served under /videos/:filename)
app.get('/highlight/latest', async (req, res, next) => {
  try {
    const { sessionId } = req.query ?? {};
    const files = await fs.readdir(VIDEO_DIR).catch(() => []);
    const clips = files.filter((f) => {
      if (!f.endsWith('_highlight.mp4')) return false;
      if (typeof sessionId === 'string' && sessionId.trim()) {
        return f.startsWith(sessionId.trim() + '_');
      }
      return true;
    }).sort().reverse();
    if (!clips.length) {
      res.json({ filename: null });
      return;
    }
    res.json({ filename: clips[0] });
  } catch (e) { next(e); }
});

// Live transcript + events (SSE) — now pushes transcript lines in real-time
app.get('/transcript/live', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const client = { res };
  sseClients.push(client);

  // Send current state
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: 'connected' });

  if (currentSession) {
    send({ type: 'session_active', sessionId: currentSession.id });
    // Send existing transcript lines
    currentSession.transcript.forEach((line, i) => {
      send({ type: 'transcript_line', line, totalLines: i + 1 });
    });
  }

  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== client);
  });
});

function broadcastSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    try { client.res.write(msg); } catch {}
  });
}

function normalizeBodyProblem(s) {
  if (!s) return null;
  const t = String(s).toLowerCase();
  if (/(cold|cough|flu|fever|uri|throat|sore throat|sinus|infection)/.test(t)) return null;
  // prefer a core anatomy keyword we also label in MoveNet overlay
  const keys = ['head', 'neck', 'shoulder', 'chest', 'abdomen', 'hip', 'arm', 'hand', 'wrist', 'leg', 'knee', 'ankle', 'foot', 'back'];
  for (const k of keys) {
    if (t.includes(k)) return k;
  }
  return t.trim() || null;
}

function chooseHighlightEvent(focusEvents, targetKeyword) {
  if (!Array.isArray(focusEvents) || !focusEvents.length) return null;
  const keyword = targetKeyword ? String(targetKeyword).toLowerCase() : null;

  let bestIdx = -1;
  let bestScore = -Infinity;

  for (let i = 0; i < focusEvents.length; i++) {
    const e = focusEvents[i];
    const labelRaw = String(e?.label ?? '');
    const label = labelRaw.toLowerCase();
    const ok = keyword ? label.includes(keyword) : true;
    if (!ok) continue;

    // Prefer non-head moments when keyword is unknown (intro chat often centers head).
    const headPenalty = !keyword && label.includes('head') ? 0.35 : 0;
    const rank = Number.isFinite(e.rank) ? e.rank : 0;

    // Prefer longer segments when possible: duration until next focus change.
    const t0 = Number(e.t_ms) || 0;
    const t1 = Number(focusEvents[i + 1]?.t_ms);
    const segMs = Number.isFinite(t1) ? Math.max(0, t1 - t0) : 0;
    const segBonus = Math.min(0.25, segMs / 20_000); // up to +0.25 for ~20s+

    const score = rank + segBonus - headPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx === -1) return null;
  const e = focusEvents[bestIdx];
  const next = focusEvents[bestIdx + 1] ?? null;
  return { e, next };
}

async function writeHighlightClip({ sourcePath, sessionId, startMs, durationMs }) {
  if (!ffmpegAvailable) return null;
  if (!sourcePath) return null;
  const startSec = Math.max(0, startMs / 1000);
  const durSec = Math.max(6, Math.min(48, (durationMs ?? 14_000) / 1000));
  const outName = `${sessionId}_highlight.mp4`;
  const outPath = path.join(VIDEO_DIR, outName);

  // Re-encode a short clip for compatibility (fast enough for ~seconds).
  await execAsync(
    `ffmpeg -ss ${startSec.toFixed(3)} -i "${sourcePath}" -t ${durSec.toFixed(3)} ` +
    `-c:v libx264 -preset veryfast -crf 26 -c:a aac -b:a 96k -movflags +faststart "${outPath}" -y`
  );

  return outName;
}

// Session status
app.get('/session/status', (req, res) => {
  res.json({
    active: !!currentSession,
    sessionId: currentSession?.id ?? null,
    transcriptLines: currentSession?.transcript?.length ?? 0,
    videoChunks: currentSession?.videoChunks?.length ?? 0,
    duration: currentSession ? Math.round((Date.now() - currentSession.startTime) / 1000) : 0,
  });
});

// Reset
app.post('/reset', async (req, res, next) => {
  try {
    currentSession = null;
    const file = path.join(process.cwd(), 'data', 'transcript.txt');
    await fs.writeFile(file, '', 'utf8');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ─── SOAP JSON (Gemini) ─────────────────────────────────────────────────────
/** Build an ordered, deduped model list so 403/allowlist on one id can fall through. */
function uniqueGeminiModels(primary, ...fallbacks) {
  const out = [];
  const add = (m) => {
    if (m == null || typeof m !== 'string') return;
    const x = m.trim();
    if (!x || out.includes(x)) return;
    out.push(x);
  };
  add(primary);
  for (const f of fallbacks) add(f);
  return out;
}

/**
 * Fallback chain when primary hits 403/429. Omit bare gemini-1.5-* (often 404).
 */
const GEMINI_MODEL_FALLBACKS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash',
  'gemini-flash-latest',
];

function geminiPrimarySoap() {
  return (
    process.env.GEMINI_SOAP_MODEL ||
    process.env.GEMINI_MODEL ||
    'gemini-2.5-flash-lite'
  );
}

function geminiPrimaryChart() {
  return (
    process.env.GEMINI_CHART_MODEL ||
    process.env.GEMINI_SOAP_MODEL ||
    process.env.GEMINI_MODEL ||
    'gemini-2.5-flash-lite'
  );
}

function soapGeminiModelIds() {
  return uniqueGeminiModels(geminiPrimarySoap(), ...GEMINI_MODEL_FALLBACKS);
}

function chartGeminiModelIds() {
  return uniqueGeminiModels(geminiPrimaryChart(), ...GEMINI_MODEL_FALLBACKS);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Daily / per-model free-tier limits will not clear on a long wait — try next model instead. */
function gemini429IsDailyOrModelQuota(err) {
  const msg = String(err?.message || err);
  if (/GenerateRequestsPerDay|PerDayPerProjectPerModel|free_tier_requests/i.test(msg)) return true;
  const m = msg.match(/retry in ([\d.]+)\s*s/i);
  if (m) {
    const sec = parseFloat(m[1], 10);
    if (Number.isFinite(sec) && sec > 20) return true;
  }
  return false;
}

/**
 * One short retry for transient RPM 429s only. Long "retry in" / daily quota → 0 so the
 * model loop can switch to the next id (e.g. flash-lite) immediately.
 */
function gemini429RetryDelayMs(err) {
  const msg = String(err?.message || err);
  if (gemini429IsDailyOrModelQuota(err)) return 0;
  const m = msg.match(/retry in ([\d.]+)\s*s/i);
  if (m) {
    const sec = parseFloat(m[1], 10);
    if (!Number.isFinite(sec) || sec > 20) return 0;
    return Math.min(10_000, Math.ceil(sec * 1000) + 400);
  }
  if (/429|Too Many Requests|quota exceeded/i.test(msg)) return 2_500;
  return 0;
}

async function withGemini429Retry(label, fn) {
  try {
    return await fn();
  } catch (e) {
    const ms = gemini429RetryDelayMs(e);
    if (ms <= 0) throw e;
    console.warn(`   ⏳ ${label}: rate limit — waiting ${Math.round(ms / 1000)}s then retry once…`);
    await sleep(ms);
    return await fn();
  }
}

function getSoapJsonPrompt(transcriptText) {
  return `Transform the following consultation transcript into a SOAP note as JSON.

Rules:
- Use ONLY information supported by the transcript. Do not fabricate vitals, tests, or diagnoses that were never discussed.
- You MUST still complete Objective, Assessment, and Plan as usable charting:
  - If something was explicitly said (exam, impression, meds, follow-up), put it in the structured fields AND/OR the summary strings.
  - If a section truly has no documented content, set the summary to a brief honest line such as "No objective examination findings documented in this transcript." or "Assessment not explicitly stated; differential may include …" only when reasonably implied by symptoms discussed.
- Remove filler and small talk.
- Return ONLY valid JSON (no markdown), matching this shape:

{
  "meta": { "visit_type": "clinical|non-clinical|unclear", "source": "glancescribe" },
  "patient": { "name": null, "age": null, "sex": null },
  "encounter": { "chief_complaint": null, "date_time": null },
  "soap": {
    "subjective": { "hpi": [], "ros": { "positive": [], "negative": [] } },
    "objective": {
      "vitals": {},
      "physical_exam": [],
      "summary": "2–6 sentences: vitals if stated; exam findings if stated; otherwise explicitly note that none were documented."
    },
    "assessment": {
      "problem_list": [],
      "summary": "2–6 sentences: working problems or diagnoses mentioned or reasonably implied from the visit; if none stated, summarize clinical question based on HPI."
    },
    "plan": {
      "medications": [],
      "follow_up": [],
      "patient_instructions": [],
      "summary": "2–6 sentences: tests, treatments, referrals, follow-up, patient education actually discussed; if sparse, say what was agreed or 'Plan not fully documented in transcript.'"
    }
  },
  "missing_info_questions": [],
  "uncertainties": []
}

TRANSCRIPT:
${transcriptText}`;
}

async function generateSoapFromTranscript(transcriptText) {
  const trimmed = (transcriptText || '').trim();
  if (!trimmed) {
    return {
      meta: { visit_type: 'unclear', source: 'glancescribe', note: 'empty transcript' },
      patient: { name: null, age: null, sex: null },
      encounter: { chief_complaint: null, date_time: null },
      soap: {
        subjective: { hpi: [], ros: { positive: [], negative: [] } },
        objective: { vitals: {}, physical_exam: [], summary: null },
        assessment: { problem_list: [], summary: null },
        plan: { medications: [], follow_up: [], patient_instructions: [], summary: null },
      },
      missing_info_questions: [],
      uncertainties: ['No transcript text to summarize.'],
    };
  }

  const apiKey = requireEnv('GEMINI_API_KEY');
  const genAI = new GoogleGenerativeAI(apiKey);
  const systemInstruction =
    'You are a careful medical scribe. Output only valid JSON for SOAP documentation. No markdown. ' +
    'Always include non-empty objective.summary, assessment.summary, and plan.summary when there is any clinical content, ' +
    'or explicit sentences stating what was not documented.';
  const prompt = getSoapJsonPrompt(trimmed);

  async function runSoapOnce(modelId) {
    const model = genAI.getGenerativeModel({ model: modelId, systemInstruction });
    let text;
    try {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
        },
      });
      text = result.response.text().trim();
    } catch {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
      });
      text = result.response.text().trim();
    }
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(clean);
  }

  let lastErr;
  for (const modelId of soapGeminiModelIds()) {
    try {
      const soap = await withGemini429Retry(`SOAP ${modelId}`, () => runSoapOnce(modelId));
      console.log(`   📄 SOAP via ${modelId}`);
      return soap;
    } catch (e) {
      lastErr = e;
      console.warn(`   ⚠️ SOAP model ${modelId} failed:`, e.message);
    }
  }
  throw lastErr;
}

app.post('/finalize', async (req, res, next) => {
  try {
    const file = path.join(process.cwd(), 'data', 'transcript.txt');
    const transcriptText = await fs.readFile(file, 'utf8').catch(() => '');
    if (!transcriptText.trim()) {
      res.status(400).json({ error: 'Transcript is empty' });
      return;
    }
    const soap = await generateSoapFromTranscript(transcriptText);
    const soapPath = path.join(process.cwd(), 'data', 'soap.json');
    await fs.writeFile(soapPath, JSON.stringify(soap, null, 2), 'utf8');
    res.json({ ok: true, path: 'data/soap.json', soap });
  } catch (e) {
    next(e);
  }
});

app.get('/soap', async (req, res, next) => {
  try {
    const soapPath = path.join(process.cwd(), 'data', 'soap.json');
    const data = await fs.readFile(soapPath, 'utf8');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.send(data);
  } catch (e) {
    res.status(404).json({ error: 'No soap.json yet' });
  }
});

// ─── GEMINI ANALYSIS ─────────────────────────────────────────────────────────
async function runGeminiAnalysis(transcriptText, videoPath, sessionId) {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const genAI = new GoogleGenerativeAI(apiKey);

  console.log('   🤖 Running Gemini analysis...');

  const prompt = `You are a medical documentation AI. You will be given a transcript of a doctor-patient consultation.

Your job is to:
1. Identify who is the DOCTOR and who is the PATIENT based on context clues
2. Extract ALL medically relevant information
3. Identify any body parts mentioned or examined
4. Structure everything into a clean patient chart JSON

Return ONLY valid JSON with this exact structure (no markdown, no preamble):
{
  "sessionId": "${sessionId}",
  "generatedAt": "${new Date().toISOString()}",
  "bodyPartProblem": "string|null (single most likely primary body part involved in the visit, e.g. \"knee\", \"left shoulder\"; null for systemic/URI-only visits)",
  "participants": {
    "doctor": {
      "identified": true or false,
      "identifyingClues": "why you think this person is the doctor"
    },
    "patient": {
      "identified": true or false,
      "name": "name if mentioned, otherwise null",
      "age": "age if mentioned, otherwise null",
      "identifyingClues": "why you think this person is the patient"
    }
  },
  "chiefComplaint": "main reason for visit in one sentence",
  "historyOfPresentIllness": "narrative of patient's story",
  "symptomsReported": [
    { "symptom": "", "severity": "mild/moderate/severe/not specified", "duration": "", "location": "" }
  ],
  "bodyPartsExamined": [
    { "bodyPart": "", "side": "left/right/both/center", "findings": "", "mentionedBy": "doctor/patient" }
  ],
  "physicalExamFindings": "what the doctor observed or examined",
  "doctorAssessment": "doctor's impressions or diagnosis",
  "planAndTreatment": {
    "medications": [],
    "followUp": "",
    "instructions": [],
    "referrals": []
  },
  "keyExchanges": [
    { "speaker": "Doctor/Patient", "statement": "important statement summarized" }
  ],
  "flags": {
    "urgentItems": [],
    "unclearItems": [],
    "requiresFollowUp": []
  },
  "transcriptQuality": "good/fair/poor",
  "notes": "anything else clinically relevant"
}

IMPORTANT for bodyPartsExamined:
- Use anatomically standard names: "head", "neck", "shoulder", "chest", "abdomen", "upper back", "lower back", "hip", "upper arm", "forearm", "wrist", "hand", "thigh", "knee", "shin", "ankle", "foot"
- Always include the "side" field: "left", "right", "both", or "center"
- Be specific: "right knee" not just "knee" if laterality is mentioned

TRANSCRIPT:
${transcriptText}

Remember: Return ONLY the JSON object. No explanation, no markdown code blocks.`;

  const parts = [{ text: prompt }];

  let lastErr;
  for (const modelId of chartGeminiModelIds()) {
    try {
      const runChart = async () => {
        const model = genAI.getGenerativeModel({ model: modelId });
        const result = await model.generateContent(parts);
        const text = result.response.text().trim();
        const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        return JSON.parse(clean);
      };
      const chart = await withGemini429Retry(`Chart ${modelId}`, runChart);
      console.log(`   📋 Chart via ${modelId}`);
      return chart;
    } catch (e) {
      lastErr = e;
      console.warn(`   ⚠️ Chart model ${modelId} failed:`, e.message);
    }
  }
  throw lastErr;
}

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  const statusCode = err?.statusCode && Number.isFinite(err.statusCode) ? err.statusCode : 500;
  console.error('Server error:', err.message);
  res.status(statusCode).json({ error: err?.message ?? 'Server error' });
});

const localIP = getLocalIP();

const useHttps =
  String(process.env.HTTPS || process.env.USE_HTTPS || '').toLowerCase() === 'true' ||
  String(process.env.HTTPS || process.env.USE_HTTPS || '') === '1';

async function startServer() {
  if (useHttps) {
    const keyPath = process.env.HTTPS_KEY_FILE || path.join(process.cwd(), 'certs', 'localhost-key.pem');
    const certPath = process.env.HTTPS_CERT_FILE || path.join(process.cwd(), 'certs', 'localhost.pem');

    if (!existsSync(keyPath) || !existsSync(certPath)) {
      console.warn('\n⚠️  HTTPS enabled but cert files missing.');
      console.warn(`   Expected key:  ${keyPath}`);
      console.warn(`   Expected cert: ${certPath}`);
      console.warn('   Falling back to HTTP.\n');
    } else {
      const [key, cert] = await Promise.all([
        fs.readFile(keyPath),
        fs.readFile(certPath),
      ]);
      https.createServer({ key, cert }, app).listen(port, '0.0.0.0', () => {
        console.log('\n╔══════════════════════════════════════════════╗');
        console.log('║         GlanceScribe Medical System           ║');
        console.log('╠══════════════════════════════════════════════╣');
        console.log(`║  Local:     https://localhost:${port}             ║`);
        console.log(`║  iPhone:    https://${localIP}:${port}      ║`);
        console.log(`║  Dashboard: https://localhost:${port}/dashboard.html║`);
        console.log('╠══════════════════════════════════════════════╣');
        console.log(`║  Videos:    ${VIDEO_DIR}`);
        console.log('╚══════════════════════════════════════════════╝\n');
      });
      return;
    }
  }

  app.listen(port, '0.0.0.0', () => {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║         GlanceScribe Medical System           ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Local:     http://localhost:${port}              ║`);
    console.log(`║  iPhone:    http://${localIP}:${port}       ║`);
    console.log(`║  Dashboard: http://localhost:${port}/dashboard.html ║`);
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Videos:    ${VIDEO_DIR}`);
    console.log('╚══════════════════════════════════════════════╝\n');
  });
}

startServer();
