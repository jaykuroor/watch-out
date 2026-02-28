export function LoadingSkeleton() {
  const shimmerStyle: React.CSSProperties = {
    background:
      'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)',
    backgroundSize: '200% 100%',
    animation: 'factcheck-shimmer 1.5s infinite linear',
    borderRadius: '8px',
  };

  return (
    <div data-testid="loading-skeleton">
      <style>{`
        @keyframes factcheck-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes factcheck-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>

      <div style={{ ...shimmerStyle, height: '72px', marginBottom: '16px' }} />

      {[1, 2, 3].map((i) => (
        <div key={i} style={{ ...shimmerStyle, height: '64px', marginBottom: '8px' }} />
      ))}

      <div
        style={{
          textAlign: 'center',
          color: 'rgba(255,255,255,0.25)',
          fontSize: '12px',
          marginTop: '20px',
          animation: 'factcheck-pulse 2s ease-in-out infinite',
        }}
      >
        Analyzing claims...
      </div>
    </div>
  );
}
