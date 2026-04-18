import React, { useState, useRef, useEffect } from 'react';
import Logo from './Logo';

const ELEVENLABS_API_KEY = 'YOUR_ELEVENLABS_KEY_HERE';

export default function RecordPage({ onStop }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef(null);
  const websocketRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);
  const transcriptRef = useRef('');

  const formatTime = (s) => {
    const m = String(Math.floor(s / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${m}:${sec}`;
  };

  const startRecording = async () => {
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      alert('Microphone access denied.');
      return;
    }

    websocketRef.current = new WebSocket('wss://api.elevenlabs.io/v1/speech-to-text/stream/scribe_v1');

    websocketRef.current.onopen = () => {
      websocketRef.current.send(JSON.stringify({
        xi_api_key: ELEVENLABS_API_KEY,
        language_code: 'en',
      }));
      startAudioPipeline();
      setRecording(true);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    };

    websocketRef.current.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'transcript' && data.is_final) {
        transcriptRef.current += (transcriptRef.current ? ' ' : '') + data.text;
      }
    };

    websocketRef.current.onerror = () => {
      alert('ElevenLabs connection failed — check your API key.');
      stopRecording();
    };
  };

  const startAudioPipeline = () => {
    audioContextRef.current = new AudioContext({ sampleRate: 16000 });
    const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
    processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
    processorRef.current.onaudioprocess = (e) => {
      if (!websocketRef.current || websocketRef.current.readyState !== WebSocket.OPEN) return;
      const float32 = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      websocketRef.current.send(int16.buffer);
    };
    source.connect(processorRef.current);
    processorRef.current.connect(audioContextRef.current.destination);
  };

  const stopRecording = () => {
    clearInterval(timerRef.current);
    setRecording(false);
    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (websocketRef.current) { websocketRef.current.close(); websocketRef.current = null; }

    // For testing without ElevenLabs, use this fallback:
    const finalTranscript = transcriptRef.current ||
      "Patient came in with left knee pain, moderate swelling, rates pain 6 out of 10, started two days ago after a fall. On exam there is visible swelling over the lateral knee, negative lachman test, no signs of fracture. Plan is RICE protocol, ibuprofen 400mg three times daily for 5 days, knee brace fitted, follow up with orthopedics in one week.";

    onStop(finalTranscript);
    setSeconds(0);
    transcriptRef.current = '';
  };

  useEffect(() => () => clearInterval(timerRef.current), []);

  return (
    <div style={styles.page}>
      <Logo size="lg" />

      <p style={styles.desc}>
        Hands-free ER documentation.<br />
        Press the mic to begin recording the patient encounter.
      </p>

      {/* Waveform */}
      <div style={styles.waveWrap}>
        {[6, 14, 20, 10, 24, 16, 8, 18, 12].map((h, i) => (
          <div key={i} style={{
            ...styles.waveBar,
            height: recording ? undefined : h,
            animation: recording ? `waveAnim 0.8s ease-in-out ${i * 0.08}s infinite alternate` : 'none',
          }} />
        ))}
      </div>

      {/* Mic button */}
      <div
        onClick={recording ? undefined : startRecording}
        style={{
          ...styles.micRing,
          borderColor: recording ? '#ef4444' : '#1e2a3a',
          boxShadow: recording ? '0 0 0 8px rgba(239,68,68,0.08), 0 0 0 18px rgba(239,68,68,0.04)' : 'none',
          cursor: recording ? 'default' : 'pointer',
        }}
      >
        <div style={{ ...styles.micInner, background: recording ? '#7f1d1d' : '#1e2a3a' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
            stroke={recording ? '#ef4444' : '#475569'}
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </div>
      </div>

      {/* Timer */}
      <div style={{ ...styles.timer, color: recording ? '#ef4444' : '#1e2a3a' }}>
        {formatTime(seconds)}
      </div>

      {/* Stop button */}
      <button
        onClick={recording ? stopRecording : undefined}
        style={{
          ...styles.stopBtn,
          opacity: recording ? 1 : 0,
          pointerEvents: recording ? 'all' : 'none',
        }}
      >
        Stop &amp; Process
      </button>

      <p style={styles.hint}>
        {recording ? 'recording... tap "Stop & Process" when done' : 'tap mic to start recording'}
      </p>

      <style>{`
        @keyframes waveAnim {
          from { height: 4px; }
          to { height: 24px; }
        }
      `}</style>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0b0f17',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    padding: '48px 24px',
  },
  desc: {
    fontSize: 13,
    fontFamily: "'IBM Plex Mono', monospace",
    color: '#475569',
    textAlign: 'center',
    maxWidth: 360,
    lineHeight: 1.8,
  },
  waveWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    height: 32,
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
    background: '#ef4444',
    transition: 'height 0.1s',
  },
  micRing: {
    width: 140,
    height: 140,
    borderRadius: '50%',
    border: '2px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.3s',
  },
  micInner: {
    width: 88,
    height: 88,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.3s',
  },
  timer: {
    fontSize: 38,
    fontWeight: 700,
    fontFamily: "'IBM Plex Mono', monospace",
    letterSpacing: 3,
    transition: 'color 0.3s',
  },
  stopBtn: {
    padding: '12px 44px',
    background: 'transparent',
    border: '0.5px solid #334155',
    borderRadius: 10,
    color: '#94a3b8',
    fontFamily: "'Syne', sans-serif",
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.3s',
  },
  hint: {
    fontSize: 11,
    fontFamily: "'IBM Plex Mono', monospace",
    color: '#334155',
    textAlign: 'center',
  },
};
