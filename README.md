# 👓 GlanceScribe — AI Medical Consultation Recorder

**Hands-free AI medical charting powered by Meta smart glasses.** Streams real-time POV video and audio from the doctor's perspective, transcribes clinical speech via ElevenLabs Scribe v2, analyzes visual findings through AI vision, and auto-generates structured SOAP notes with an interactive 3D body diagram. Built at Hack Brooklyn 2026.

---

## Architecture

```
iPhone / Meta Glasses (index.html)
  ├── Camera + Mic → MediaRecorder (video chunks → /video/chunk)
  ├── Audio PCM → ElevenLabs Scribe WebSocket (real-time transcript)
  └── Transcript lines → /append (pushed to dashboard via SSE)

MacBook Server (server.js)
  ├── Receives video chunks → assembles → ffmpeg → .mp4
  ├── Pushes transcript lines to dashboard via SSE (real-time)
  ├── On STOP: sends transcript to Gemini → JSON patient chart
  └── Dashboard (dashboard.html) displays everything live
      └── Interactive 3D body model (Three.js) with highlighted areas
```

---

## Quick Start

```bash
# 1. Navigate to project folder
cd GlanceScribe

# 2. Install dependencies
npm install

# 3. Create .env from example
cp .env.example .env
# Edit .env with your API keys

# 4. Start
npm start
```

### Access Points
- **MacBook Dashboard:** `http://localhost:5179/dashboard.html`
- **iPhone Recording:** `http://<YOUR-MAC-IP>:5179` (same Wi-Fi)

---

## Requirements

- **Node.js 18+**
- **ffmpeg** (optional, for MP4 compression) — `brew install ffmpeg`
- **iPhone + MacBook on same Wi-Fi**
- **ElevenLabs API key** (Scribe v2)
- **Google Gemini API key**
- **Tavily API key** (optional — for the floating medical chat search)

---

## Project Structure

```
GlanceScribe/
├── server.js           ← Express server + Gemini analysis
├── package.json
├── .env                ← API keys (create from .env.example)
├── .env.example
├── public/
│   ├── index.html       ← iPhone recording page
│   ├── dashboard.html   ← MacBook dashboard + 3D body + SOAP tab
│   └── chat-widget.js   ← floating medical chat (needs TAVILY_API_KEY)
├── data/               ← transcripts + chart JSONs (auto-created)
└── videos/             ← MP4 recordings (auto-created)
```

---

## Features

| Tab | Description |
|-----|-------------|
| 📋 Chart | Participants, chief complaint, HPI, symptoms, exam findings |
| 💬 Conversation | Doctor/patient exchange breakdown |
| 🫀 3D Body | Interactive Three.js body model — drag to rotate, scroll to zoom, affected areas glow |
| 💊 Plan | Medications, follow-up, instructions, referrals |
| ⚑ Flags | Urgent items, unclear points, follow-up required |
| 📄 SOAP Chart | Paper-style SOAP note (from `data/soap.json`) |
| { } JSON | Raw Gemini output for debugging/export |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `MODULE_NOT_FOUND` | Make sure you `cd` into the GlanceScribe folder before running `npm start` |
| "Can't GET /" on iPhone | HTML files must be inside `public/` folder |
| Camera not showing | Use **Safari** on iOS, allow camera+mic permissions |
| Scribe not connecting | Check `ELEVENLABS_API_KEY` in `.env` |
| Gemini failing | Check `GEMINI_API_KEY` in `.env` |
| iPhone can't reach Mac | Both on same Wi-Fi, check Mac firewall allows Node.js |
