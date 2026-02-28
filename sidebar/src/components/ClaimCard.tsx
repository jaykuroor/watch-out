import { useState } from 'react';
import type { Claim } from './Sidebar';

const VERDICT_CONFIG = {
  supported: {
    bg: 'rgba(34, 197, 94, 0.10)',
    border: 'rgba(34, 197, 94, 0.25)',
    accentColor: '#22c55e',
    icon: '✅',
    label: 'Supported',
  },
  refuted: {
    bg: 'rgba(239, 68, 68, 0.10)',
    border: 'rgba(239, 68, 68, 0.25)',
    accentColor: '#ef4444',
    icon: '❌',
    label: 'Refuted',
  },
  unclear: {
    bg: 'rgba(234, 179, 8, 0.10)',
    border: 'rgba(234, 179, 8, 0.25)',
    accentColor: '#eab308',
    icon: '⚠️',
    label: 'Unclear',
  },
} as const;

const CONFIDENCE_DOTS: Record<string, string> = {
  low: '●○○',
  med: '●●○',
  high: '●●●',
};

export function ClaimCard({ claim }: { claim: Claim }) {
  const [expanded, setExpanded] = useState(false);
  const config = VERDICT_CONFIG[claim.verdict];

  return (
    <div
      data-testid={`claim-card-${claim.id}`}
      style={{
        marginBottom: '8px',
        borderRadius: '10px',
        border: `1px solid ${config.border}`,
        background: config.bg,
        overflow: 'hidden',
        transition: 'all 0.15s ease',
      }}
    >
      {/* Collapsed view — always visible */}
      <div
        onClick={() => setExpanded(!expanded)}
        role="button"
        aria-expanded={expanded}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        style={{ padding: '12px', cursor: 'pointer', userSelect: 'none' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '6px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px' }}>{config.icon}</span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: config.accentColor,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {config.label}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', letterSpacing: '2px' }}
            >
              {CONFIDENCE_DOTS[claim.confidence]}
            </span>
            <span
              style={{
                fontSize: '14px',
                color: 'rgba(255,255,255,0.3)',
                transition: 'transform 0.2s ease',
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                display: 'inline-block',
              }}
            >
              ▾
            </span>
          </div>
        </div>

        <div style={{ fontSize: '13px', lineHeight: 1.5, color: 'rgba(255,255,255,0.85)' }}>
          {claim.text}
        </div>
      </div>

      {/* Expanded dropdown */}
      {expanded && (
        <div
          data-testid={`claim-details-${claim.id}`}
          style={{
            padding: '0 12px 12px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            paddingTop: '10px',
          }}
        >
          <div
            style={{
              fontSize: '12px',
              lineHeight: 1.6,
              color: 'rgba(255,255,255,0.6)',
              marginBottom: '8px',
            }}
          >
            {claim.explanation}
          </div>

          {claim.what_to_check_next && (
            <div
              style={{
                fontSize: '11px',
                color: 'rgba(234, 179, 8, 0.7)',
                fontStyle: 'italic',
                marginBottom: '8px',
                padding: '6px 8px',
                background: 'rgba(234, 179, 8, 0.05)',
                borderRadius: '6px',
              }}
            >
              💡 {claim.what_to_check_next}
            </div>
          )}

          {claim.sources.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: '10px',
                  color: 'rgba(255,255,255,0.25)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: '6px',
                }}
              >
                Sources
              </div>
              {claim.sources.map((source, i) => (
                <a
                  key={i}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: 'block',
                    padding: '6px 8px',
                    marginBottom: '4px',
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: '6px',
                    textDecoration: 'none',
                    transition: 'background 0.1s ease',
                  }}
                >
                  <div
                    style={{
                      fontSize: '11px',
                      color: '#60a5fa',
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    🔗 {source.title || source.url}
                  </div>
                  {source.snippet && (
                    <div
                      style={{
                        fontSize: '10px',
                        color: 'rgba(255,255,255,0.3)',
                        marginTop: '2px',
                        lineHeight: 1.4,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {source.snippet}
                    </div>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
