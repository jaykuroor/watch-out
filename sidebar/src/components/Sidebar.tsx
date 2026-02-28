import { VerificationBar } from './VerificationBar.js';
import { ClaimCard } from './ClaimCard.js';
import { LoadingSkeleton } from './LoadingSkeleton.js';

export interface Claim {
  id: number;
  text: string;
  verdict: 'supported' | 'refuted' | 'unclear';
  confidence: 'low' | 'med' | 'high';
  explanation: string;
  sources: { title: string; url: string; snippet: string }[];
  what_to_check_next?: string;
}

export interface SidebarProps {
  state: 'idle' | 'loading' | 'result' | 'error' | 'no_transcript';
  metadata?: { title: string; channel: string };
  overallScore?: number | null;
  claims?: Claim[];
  transcriptPreview?: string;
  errorMessage?: string;
  onClose: () => void;
}

export function Sidebar(props: SidebarProps) {
  const { state, metadata, overallScore, claims, errorMessage, onClose } = props;

  if (state === 'idle') return null;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'rgba(15, 15, 15, 0.97)',
        backdropFilter: 'blur(16px)',
        borderRadius: '16px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        color: 'white',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        overflowY: 'auto',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 16px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🔍</span>
            <span style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '-0.3px' }}>
              Fact Check
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close sidebar"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              fontSize: '16px',
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {metadata && (metadata.title || metadata.channel) && (
          <div
            style={{
              marginTop: '10px',
              padding: '8px 10px',
              background: 'rgba(255,255,255,0.04)',
              borderRadius: '8px',
            }}
          >
            <div
              style={{
                fontSize: '12px',
                fontWeight: 500,
                color: 'rgba(255,255,255,0.85)',
                lineHeight: 1.3,
                marginBottom: metadata.channel ? '2px' : '0',
              }}
            >
              {metadata.title}
            </div>
            {metadata.channel && (
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                {metadata.channel}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '16px', flex: 1, overflowY: 'auto' }}>
        {state === 'loading' && <LoadingSkeleton />}

        {state === 'no_transcript' && (
          <div style={{ padding: '32px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔇</div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 500,
                color: 'rgba(255,255,255,0.7)',
                marginBottom: '6px',
              }}
            >
              No Transcript Available
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>
              This Short doesn't have captions, so we can't verify its claims reliably.
            </div>
          </div>
        )}

        {state === 'error' && (
          <div style={{ padding: '32px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚠️</div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 500,
                color: '#ff6b6b',
                marginBottom: '6px',
              }}
            >
              Something went wrong
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>
              {errorMessage || 'Failed to analyze this Short. Please try again.'}
            </div>
          </div>
        )}

        {state === 'result' && (
          <>
            {overallScore !== null && overallScore !== undefined && claims && claims.length > 0 && (
              <VerificationBar score={overallScore} claimCount={claims.length} />
            )}

            {(!claims || claims.length === 0) && (
              <div
                style={{
                  padding: '24px 16px',
                  textAlign: 'center',
                  color: 'rgba(255,255,255,0.4)',
                  fontSize: '13px',
                }}
              >
                No verifiable factual claims found in this Short.
              </div>
            )}

            {claims && claims.length > 0 && (
              <div style={{ marginTop: '12px' }}>
                <div
                  style={{
                    fontSize: '10px',
                    color: 'rgba(255,255,255,0.3)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.8px',
                    fontWeight: 600,
                    marginBottom: '10px',
                  }}
                >
                  {claims.length} claim{claims.length !== 1 ? 's' : ''} analyzed
                </div>
                {claims.map((claim) => (
                  <ClaimCard key={claim.id} claim={claim} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
