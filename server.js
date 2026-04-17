import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';
import multer from 'multer';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const execAsync = promisify(exec);

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 5179;

// ─── Video storage path (create if needed) ───────────────────────────────────
const VIDEO_DIR = process.env.VIDEO_DIR
  ? path.resolve(process.env.VIDEO_DIR)
  : path.join(process.cwd(), 'videos');

await fs.mkdir(VIDEO_DIR, { recursive: true });
await fs.mkdir(path.join(process.cwd(), 'data'), { recursive: true });

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
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
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
    };

    const file = path.join(process.cwd(), 'data', 'transcript.txt');
    await fs.writeFile(file, `=== Session: ${id} ===\n`, 'utf8');

    // Notify SSE clients
    broadcastSSE({ type: 'session_start', sessionId: id });

    console.log(`\n🟢 Session started: ${id}`);
    res.json({ ok: true, sessionId: id });
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

    const { id, transcript, videoChunks } = session;
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

      if (ffmpegAvailable) {
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

    // ── Run Gemini analysis ────────────────────────────────────────────────────
    let patientChart = null;
    let analysisError = null;

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

    try {
      const soap = await generateSoapFromTranscript(transcriptText);
      const soapPath = path.join(process.cwd(), 'data', 'soap.json');
      await fs.writeFile(soapPath, JSON.stringify(soap, null, 2), 'utf8');
      console.log(`   📄 SOAP saved: ${soapPath}`);
      broadcastSSE({ type: 'soap_ready', sessionId: id });
    } catch (soapErr) {
      console.error('   ❌ SOAP /finalize failed:', soapErr.message);
    }

    res.json({
      ok: true,
      sessionId: id,
      duration,
      videoPath: videoPath ? path.basename(videoPath) : null,
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

// ─── SOAP JSON (Gemini 2.5 Flash) ────────────────────────────────────────────
function getSoapJsonPrompt(transcriptText) {
  return `Transform the following consultation transcript into a SOAP note as JSON.

Rules:
- Do NOT invent clinical facts; only use what is in the transcript.
- Remove filler and small talk.
- Return ONLY valid JSON (no markdown), matching this shape:

{
  "meta": { "visit_type": "clinical|non-clinical|unclear", "source": "glancescribe" },
  "patient": { "name": null, "age": null, "sex": null },
  "encounter": { "chief_complaint": null, "date_time": null },
  "soap": {
    "subjective": { "hpi": [], "ros": { "positive": [], "negative": [] } },
    "objective": { "vitals": {}, "physical_exam": [] },
    "assessment": { "problem_list": [] },
    "plan": { "medications": [], "follow_up": [], "patient_instructions": [] }
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
        objective: { vitals: {}, physical_exam: [] },
        assessment: { problem_list: [] },
        plan: { medications: [], follow_up: [], patient_instructions: [] },
      },
      missing_info_questions: [],
      uncertainties: ['No transcript text to summarize.'],
    };
  }

  const apiKey = requireEnv('GEMINI_API_KEY');
  const modelId = process.env.GEMINI_SOAP_MODEL || 'gemini-2.5-flash';
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction:
      'You are a careful medical scribe. Output only valid JSON for SOAP documentation. No markdown.',
  });

  const prompt = getSoapJsonPrompt(trimmed);

  let text;
  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    });
    text = result.response.text().trim();
  } catch (e1) {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    });
    text = result.response.text().trim();
  }

  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(clean);
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
    res.send(data);
  } catch (e) {
    res.status(404).json({ error: 'No soap.json yet' });
  }
});

// ─── GEMINI ANALYSIS ─────────────────────────────────────────────────────────
async function runGeminiAnalysis(transcriptText, videoPath, sessionId) {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const genAI = new GoogleGenerativeAI(apiKey);
  const fileManager = new GoogleAIFileManager(apiKey);

  const chartModel =
    process.env.GEMINI_CHART_MODEL || process.env.GEMINI_SOAP_MODEL || 'gemini-2.5-flash';
  let model;
  try {
    model = genAI.getGenerativeModel({ model: chartModel });
  } catch {
    model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  }

  console.log('   🤖 Running Gemini analysis...');

  const prompt = `You are a medical documentation AI. You will be given a transcript of a doctor-patient consultation and potentially a video of the examination.

Your job is to:
1. Identify who is the DOCTOR and who is the PATIENT based on context clues
2. Extract ALL medically relevant information
3. Identify any body parts mentioned or examined (use the video to confirm visual examinations)
4. Structure everything into a clean patient chart JSON

Return ONLY valid JSON with this exact structure (no markdown, no preamble):
{
  "sessionId": "${sessionId}",
  "generatedAt": "${new Date().toISOString()}",
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

  if (videoPath && existsSync(videoPath)) {
    try {
      console.log(`   📤 Uploading video to Gemini File API: ${path.basename(videoPath)}`);
      const uploadResult = await fileManager.uploadFile(videoPath, {
        mimeType: videoPath.endsWith('.mp4') ? 'video/mp4' : 'video/webm',
        displayName: `Session ${sessionId}`,
      });

      let file = await fileManager.getFile(uploadResult.file.name);
      process.stdout.write('   ⏳ Processing video');
      
      while (file.state === FileState.PROCESSING) {
        process.stdout.write('.');
        await new Promise((resolve) => setTimeout(resolve, 3000));
        file = await fileManager.getFile(uploadResult.file.name);
      }

      if (file.state === FileState.FAILED) {
        throw new Error('Video processing failed in Gemini File API');
      }

      console.log('\n   ✅ Video processed and ready');
      parts.push({
        fileData: {
          mimeType: file.mimeType,
          fileUri: file.uri,
        },
      });
    } catch (vErr) {
      console.warn('   ⚠️ Video upload/processing failed, falling back to transcript only:', vErr.message);
    }
  }

  const result = await model.generateContent(parts);
  const text = result.response.text().trim();
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  return JSON.parse(clean);
}

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  const statusCode = err?.statusCode && Number.isFinite(err.statusCode) ? err.statusCode : 500;
  console.error('Server error:', err.message);
  res.status(statusCode).json({ error: err?.message ?? 'Server error' });
});

const localIP = getLocalIP();

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
