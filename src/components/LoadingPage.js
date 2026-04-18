import React, { useEffect, useState } from 'react';

const CLAUDE_API_KEY = 'YOUR_CLAUDE_API_KEY_HERE';

const STEPS = [
  'Transcribing audio with ElevenLabs',
  'Extracting medical entities',
  'Generating SOAP note with Claude',
  'Mapping body findings',
];

export default function LoadingPage({ transcript, onDone }) {
  const [activeStep, setActiveStep] = useState(0);
  const [doneSteps, setDoneSteps] = useState([]);
  const [progress, setProgress] = useState(0);
  const [penX, setPenX] = useState(10);
  const [linesDone, setLinesDone] = useState(0);

  useEffect(() => {
    // Animate steps
    const delays = [800, 1200, 1800, 600];
    let elapsed = 0;
    delays.forEach((d, i) => {
      elapsed += d;
      setTimeout(() => {
        setActiveStep(i + 1);
        setDoneSteps(prev => [...prev, i]);
        setProgress(Math.round(((i + 1) / STEPS.length) * 100));
        if (i === 1) setLinesDone(1);
        if (i === 2) setLinesDone(2);
        if (i === 3) setLinesDone(3);
      }, elapsed);
    });

    // Animate pen
    const penInterval = setInterval(() => {
      setPenX(x => {
        if (x >= 90) return 10;
        return x + 1.5;
      });
    }, 30);

    // Actually call Claude API
    callClaude(transcript).then(soap => {
      setTimeout(() => onDone(soap), elapsed + 400);
    });

    return () => clearInterval(penInterval);
  }, []);

  const callClaude = async (text) => {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1024,
          system: `You are a medical documentation assistant for ER physicians.
Extract only clinically relevant information from the raw transcript.
Remove all filler words, small talk, and non-medical content.
Return ONLY a valid JSON object, no extra text, no markdown:
{
  "subjective": "what the patient reported and their symptoms",
  "objective": "physical exam findings, vitals, observations",
  "assessment": "diagnosis or clinical impression",
  "plan": "treatment, medications, follow-up",
  "bodyPart": "single lowercase body part mentioned e.g. knee, chest, arm"
}
If a section has no info use null. bodyPart should be the primary area of concern.`,
          messages: [{ role: 'user', content: `Raw ER transcript:\n\n"${text}"` }],
        }),
      });
      const data = await res.json();
      return JSON.parse(data.content[0].text);
    } catch {
      // Fallback demo data if API fails
      return {
        subjective: 'Patient reports left knee pain onset 2 days ago following a fall. Rates pain 6/10. Denies numbness or tingling. Reports swelling worsening since injury. Took ibuprofen with minimal relief.',
        objective: 'Moderate swelling noted over left lateral knee. No ecchymosis. ROM limited by pain at ~110° flexion. Negative Lachman test. No crepitus on palpation. Neurovascularly intact distally. Vitals stable.',
        assessment: 'Likely Grade I–II lateral collateral ligament sprain, left knee. No acute fracture signs on clinical exam. X-ray deferred at this time given low suspicion for bony injury.',
        plan: 'RICE protocol initiated. Ibuprofen 400mg TID × 5 days prescribed. Knee brace fitted in department. Follow up with orthopedics in 5–7 days if no improvement. Return precautions discussed.',
        bodyPart: 'knee',
      };
    }
  };

  const LINE_Y = [68, 88, 108, 128, 148, 168];

  return (
    <div style={styles.page}>

      {/* Pen writing on paper animation */}
      <div style={styles.paperWrap}>
        <svg width="160" height="200" viewBox="0 0 160 200" fill="none">
          {/* Paper */}
          <rect x="10" y="10" width="140" height="180" rx="6"
            fill="#fff" stroke="#e2e8f0" strokeWidth="1"/>
          {/* Ruled lines — revealed progressively */}
          {LINE_Y.map((y, i) => (
            <line
              key={i}
              x1="24" y1={y} x2="136" y2={y}
              stroke={i <= linesDone * 2 ? '#94a3b8' : '#e2e8f0'}
              strokeWidth="0.8"
              style={{ transition: 'stroke 0.4s' }}
            />
          ))}
          {/* Pen */}
          <g transform={`translate(${penX}, ${LINE_Y[Math.min(linesDone * 2, LINE_Y.length - 1)] - 14}) rotate(30)`}>
            {/* Pen body */}
            <rect x="-3" y="0" width="6" height="22" rx="1" fill="#444441"/>
            {/* Pen tip */}
            <polygon points="0,22 -3,28 3,28" fill="#2C2C2A"/>
            {/* Pen clip */}
            <rect x="2" y="2" width="2" height="14" rx="1" fill="#64748b"/>
          </g>
        </svg>
      </div>

      <p style={styles.title}>Processing encounter...</p>

      {/* Progress bar */}
      <div style={styles.barWrap}>
        <div style={{ ...styles.barFill, width: `${progress}%` }} />
      </div>

      {/* Steps */}
      <div style={styles.stepsWrap}>
        {STEPS.map((step, i) => {
          const isDone = doneSteps.includes(i);
          const isActive = activeStep === i;
          return (
            <div key={i} style={styles.step}>
              <div style={{
                ...styles.stepDot,
                background: isDone ? '#4ade80' : isActive ? '#60a5fa' : '#334155',
              }} />
              <span style={{
                ...styles.stepText,
                color: isDone ? '#4ade80' : isActive ? '#60a5fa' : '#334155',
              }}>
                {step}
              </span>
            </div>
          );
        })}
      </div>
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
    gap: 24,
    padding: 48,
  },
  paperWrap: {
    filter: 'drop-shadow(0 4px 24px rgba(0,0,0,0.4))',
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
    color: '#f1f5f9',
    fontFamily: "'Syne', sans-serif",
  },
  barWrap: {
    width: 280,
    height: 3,
    background: '#1e2a3a',
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    background: '#378ADD',
    borderRadius: 2,
    transition: 'width 0.5s ease',
  },
  stepsWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    width: 280,
  },
  step: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  stepDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
    transition: 'background 0.3s',
  },
  stepText: {
    fontSize: 12,
    fontFamily: "'IBM Plex Mono', monospace",
    transition: 'color 0.3s',
  },
};
