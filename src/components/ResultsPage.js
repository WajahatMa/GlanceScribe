import React, { useRef } from 'react';
import Logo from './Logo';
import BodyMap from './BodyMap';

export default function ResultsPage({ soapNote, onNewRecording }) {
  const docRef = useRef(null);

  const note = soapNote || {
    subjective: '—',
    objective: '—',
    assessment: '—',
    plan: '—',
    bodyPart: null,
  };

  const today = new Date().toLocaleDateString('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric',
  });
  const time = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit',
  });

  const handleDownload = () => {
    const content = `
SOAP NOTE
==========
Practice: GlanseScribe ER     Provider: Dr. Patel, MD
Patient: John D.              DOB: 03/12/1992
Session Date: ${today}       Session Time: ${time}

SESSION INFORMATION
Duration: ~18 min   Type: In-Person   Service Code: 99283

SUBJECTIVE
${note.subjective}

OBJECTIVE
${note.objective}

ASSESSMENT
${note.assessment}

PLAN
${note.plan}

I declare this information is accurate and complete.

Provider's Signature: ____________________   Date: ____________
    `.trim();

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SOAP_Note_${today.replace(/\//g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={styles.page}>
      {/* Top bar */}
      <div style={styles.topbar}>
        <Logo size="sm" />
        <div style={styles.topRight}>
          <span style={styles.tagGreen}>Note complete</span>
          <span style={styles.tagGray}>ER — bay 4</span>
        </div>
      </div>

      {/* Patient bar */}
      <div style={styles.patientBar}>
        <span><strong style={styles.strong}>Patient</strong> John D., 34M</span>
        <span><strong style={styles.strong}>CC</strong> {note.bodyPart ? `${note.bodyPart} pain` : 'ER visit'}</span>
        <span><strong style={styles.strong}>Date</strong> {today}</span>
        <span><strong style={styles.strong}>Provider</strong> Dr. Patel</span>
      </div>

      {/* Main two-column layout */}
      <div style={styles.cols}>

        {/* LEFT: SOAP DOCUMENT */}
        <div style={styles.leftCol}>
          <div ref={docRef} style={styles.docPaper}>

            <div style={styles.docHeader}>
              <h2 style={styles.docTitle}>— SOAP Note —</h2>
            </div>

            <div style={styles.metaGrid}>
              <MetaRow label="Practice:" value="GlanseScribe ER" />
              <MetaRow label="Provider:" value="Dr. Patel, MD" />
              <MetaRow label="Patient:" value="John D." />
              <MetaRow label="DOB:" value="03/12/1992" />
              <MetaRow label="Session Date:" value={today} />
              <MetaRow label="Session Time:" value={time} />
            </div>

            <div style={styles.siHeader}>Session Information</div>
            <div style={styles.siRow}>
              <div style={styles.siCell}><b>Duration:</b> ~18 min</div>
              <div style={styles.siCell}><b>Type:</b> In-Person</div>
              <div style={{ ...styles.siCell, borderRight: 'none' }}><b>Code:</b> 99283</div>
            </div>

            <SoapSection title="Subjective" content={note.subjective} />
            <SoapSection title="Objective" content={note.objective} />
            <SoapSection title="Assessment" content={note.assessment} />
            <SoapSection title="Plan" content={note.plan} />

            <div style={styles.docFooter}>
              <input type="checkbox" defaultChecked style={{ width: 10, height: 10 }} />
              <span> I declare this information is accurate and complete.</span>
            </div>

            <div style={styles.sigRow}>
              <div style={styles.sigCell}>
                <b style={{ display: 'block', marginBottom: 2 }}>Provider's Signature:</b>
                <div style={styles.sigLine} />
              </div>
              <div style={styles.sigCell}>
                <b style={{ display: 'block', marginBottom: 2 }}>Date:</b>
                <div style={styles.sigLine} />
              </div>
            </div>

          </div>

          <button onClick={handleDownload} style={styles.dlBtn}>
            Download PDF ↗
          </button>
          <button onClick={onNewRecording} style={styles.backBtn}>
            ← New recording
          </button>
        </div>

        {/* RIGHT: BODY MAP */}
        <div style={styles.rightCol}>
          <BodyMap bodyPart={note.bodyPart} />

          {/* Findings */}
          <div style={styles.findings}>
            <div style={styles.findingsLabel}>Detected findings</div>
            <FindingRow tag="doctor" tagColor="doc" text="Moderate swelling noted on exam" />
            <FindingRow tag="patient" tagColor="pat" text={`Pain rated 6/10 — ${note.bodyPart || 'affected area'}`} />
            <FindingRow tag="doctor" tagColor="doc" text="Negative instability test" />
            <FindingRow tag="patient" tagColor="pat" text="OTC pain relief — minimal effect" />
            <FindingRow tag="doctor" tagColor="doc" text="ROM limited, no acute fracture signs" />
          </div>
        </div>

      </div>
    </div>
  );
}

function MetaRow({ label, value }) {
  return (
    <div style={{ fontSize: 9.5, color: '#222', display: 'flex', gap: 4, alignItems: 'baseline' }}>
      <b style={{ fontWeight: 700, whiteSpace: 'nowrap', fontFamily: 'Times New Roman, serif' }}>{label}</b>
      <span style={{ borderBottom: '0.5px solid #aaa', flex: 1, fontFamily: 'Times New Roman, serif' }}>{value}</span>
    </div>
  );
}

function SoapSection({ title, content }) {
  return (
    <div style={{ margin: '0 10px' }}>
      <div style={{
        background: '#d0d0d0', padding: '2px 6px',
        fontSize: 9.5, fontWeight: 700, color: '#111',
        marginTop: 7, border: '0.5px solid #bbb',
        fontFamily: 'Times New Roman, serif',
      }}>{title}</div>
      <div style={{
        border: '0.5px solid #bbb', borderTop: 'none',
        minHeight: 52, padding: '5px 7px',
        fontSize: 9.5, color: '#1a1a1a', lineHeight: 1.65,
        fontFamily: 'Times New Roman, serif',
      }}>{content || '—'}</div>
    </div>
  );
}

function FindingRow({ tag, tagColor, text }) {
  const colors = {
    doc: { bg: '#0a1628', color: '#60a5fa', border: '#1e3a5f' },
    pat: { bg: '#1a1028', color: '#a78bfa', border: '#4c1d95' },
  };
  const c = colors[tagColor];
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 7,
      padding: '5px 0', borderBottom: '0.5px solid #1e2a3a', fontSize: 11,
    }}>
      <span style={{
        fontSize: 9, fontFamily: "'IBM Plex Mono', monospace",
        padding: '2px 6px', borderRadius: 10, flexShrink: 0, marginTop: 1,
        background: c.bg, color: c.color, border: `0.5px solid ${c.border}`,
      }}>{tag}</span>
      <span style={{ color: '#64748b', lineHeight: 1.5 }}>{text}</span>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0b0f17',
    display: 'flex',
    flexDirection: 'column',
  },
  topbar: {
    background: '#0f1520',
    borderBottom: '0.5px solid #1e2a3a',
    padding: '11px 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  topRight: { display: 'flex', gap: 10, alignItems: 'center' },
  tagGreen: {
    fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
    padding: '3px 10px', borderRadius: 20,
    background: '#0a1a0a', color: '#4ade80', border: '0.5px solid #166534',
  },
  tagGray: {
    fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
    padding: '3px 10px', borderRadius: 20,
    background: '#1e2a3a', color: '#475569', border: '0.5px solid #1e2a3a',
  },
  patientBar: {
    background: '#0d1825',
    borderBottom: '0.5px solid #1e2a3a',
    padding: '7px 20px',
    display: 'flex',
    gap: 20,
    fontSize: 11,
    fontFamily: "'IBM Plex Mono', monospace",
    color: '#475569',
    flexShrink: 0,
  },
  strong: { color: '#94a3b8', fontWeight: 500 },
  cols: {
    display: 'grid',
    gridTemplateColumns: '1.2fr 0.8fr',
    flex: 1,
    minHeight: 0,
  },
  leftCol: {
    padding: 16,
    borderRight: '0.5px solid #1e2a3a',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    overflowY: 'auto',
  },
  docPaper: {
    background: '#fff',
    borderRadius: 8,
    overflow: 'hidden',
  },
  docHeader: {
    textAlign: 'center',
    padding: '10px 14px 6px',
    borderBottom: '1px solid #ccc',
  },
  docTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#111',
    letterSpacing: '0.5px',
    fontFamily: 'Times New Roman, serif',
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    padding: '7px 12px',
    gap: '2px 12px',
    borderBottom: '1px solid #ccc',
  },
  siHeader: {
    background: '#d0d0d0',
    padding: '2px 8px',
    fontSize: 9.5,
    fontWeight: 700,
    color: '#111',
    margin: '4px 10px 0',
    fontFamily: 'Times New Roman, serif',
  },
  siRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    margin: '0 10px',
    border: '0.5px solid #bbb',
    borderTop: 'none',
  },
  siCell: {
    padding: '3px 6px',
    fontSize: 9,
    color: '#222',
    borderRight: '0.5px solid #bbb',
    fontFamily: 'Times New Roman, serif',
  },
  docFooter: {
    margin: '6px 10px 4px',
    fontSize: 8.5,
    color: '#222',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontFamily: 'Times New Roman, serif',
  },
  sigRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    margin: '3px 10px 10px',
    paddingTop: 4,
    borderTop: '0.5px solid #bbb',
  },
  sigCell: { fontSize: 8.5, color: '#222', fontFamily: 'Times New Roman, serif' },
  sigLine: { borderBottom: '0.5px solid #999', height: 16 },
  dlBtn: {
    padding: 10,
    background: '#1e3a5f',
    border: '0.5px solid #2d5a8e',
    color: '#93c5fd',
    borderRadius: 8,
    fontFamily: "'Syne', sans-serif",
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'center',
  },
  backBtn: {
    padding: 9,
    background: 'transparent',
    border: '0.5px solid #1e2a3a',
    color: '#475569',
    borderRadius: 8,
    fontFamily: "'Syne', sans-serif",
    fontSize: 12,
    cursor: 'pointer',
    textAlign: 'center',
  },
  rightCol: {
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    overflowY: 'auto',
  },
  findings: {
    background: '#0f1520',
    border: '0.5px solid #1e2a3a',
    borderRadius: 8,
    padding: '10px 12px',
  },
  findingsLabel: {
    fontSize: 10,
    fontFamily: "'IBM Plex Mono', monospace",
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#334155',
    marginBottom: 8,
  },
};
