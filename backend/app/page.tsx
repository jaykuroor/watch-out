export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>YT Fact Checker API</h1>
      <p>Backend is running. Use POST /api/analyze to analyze a YouTube Short.</p>
      <pre style={{ background: '#f4f4f4', padding: '1rem', borderRadius: '4px' }}>
{`POST /api/analyze
{
  "videoId": "abc123",
  "priority": "high" | "low"
}`}
      </pre>
    </main>
  );
}
