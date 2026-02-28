interface VerificationBarProps {
  score: number; // 0.0 to 1.0
  claimCount: number;
}

function getColor(s: number): string {
  if (s >= 0.7) return '#22c55e';
  if (s >= 0.4) return '#eab308';
  return '#ef4444';
}

function getLabel(s: number): string {
  if (s >= 0.8) return 'Well Supported';
  if (s >= 0.6) return 'Mostly Supported';
  if (s >= 0.4) return 'Mixed Evidence';
  if (s >= 0.2) return 'Weakly Supported';
  return 'Likely Misleading';
}

export function VerificationBar({ score, claimCount }: VerificationBarProps) {
  const color = getColor(score);
  const percentage = Math.round(score * 100);

  return (
    <div
      style={{
        padding: '14px',
        background: `linear-gradient(135deg, ${color}15, ${color}08)`,
        border: `1px solid ${color}30`,
        borderRadius: '12px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
          {getLabel(score)}
        </span>
        <span
          style={{ fontSize: '20px', fontWeight: 700, color, letterSpacing: '-0.5px' }}
          data-testid="score-percentage"
        >
          {percentage}%
        </span>
      </div>

      <div
        style={{
          width: '100%',
          height: '6px',
          background: 'rgba(255,255,255,0.08)',
          borderRadius: '3px',
          overflow: 'hidden',
        }}
      >
        <div
          data-testid="score-bar-fill"
          style={{
            width: `${percentage}%`,
            height: '100%',
            background: `linear-gradient(90deg, ${color}cc, ${color})`,
            borderRadius: '3px',
            transition: 'width 0.6s ease-out',
          }}
        />
      </div>

      <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '6px' }}>
        Based on {claimCount} verified claim{claimCount !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

export { getColor, getLabel };
