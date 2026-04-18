import React from 'react';

export default function Logo({ size = 'md' }) {
  const fontSize = size === 'lg' ? 28 : size === 'sm' ? 14 : 22;
  const svgSize = size === 'lg' ? 48 : size === 'sm' ? 22 : 36;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        fontFamily: "'Syne', sans-serif",
        fontSize,
        fontWeight: 700,
        color: '#f1f5f9',
        letterSpacing: '-0.5px',
      }}>
        Glanse<span style={{ color: '#378ADD' }}>Scribe</span>
      </span>
      <svg
        width={svgSize}
        height={svgSize * 0.5}
        viewBox="0 0 48 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <polyline
          points="0,12 8,12 12,4 16,20 20,2 24,22 28,12 36,12 40,8 44,12 48,12"
          stroke="#8B6F47"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
}
