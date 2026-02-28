const http = require('http');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const successResponse = {
  status: 'success',
  metadata: { title: '5 Foods That Are Secretly Destroying Your Health', channel: 'HealthTruth' },
  overallScore: 0.65,
  claims: [
    {
      id: 1,
      text: 'The Earth is 4.5 billion years old',
      verdict: 'supported',
      confidence: 'high',
      explanation: 'Multiple scientific sources confirm this.',
      sources: [{ title: 'NASA', url: 'https://nasa.gov', snippet: 'Earth formed ~4.5B years ago' }],
    },
    {
      id: 2,
      text: 'Humans only use 10% of their brain',
      verdict: 'refuted',
      confidence: 'high',
      explanation: 'This is a well-known myth.',
      sources: [
        {
          title: 'Scientific American',
          url: 'https://scientificamerican.com',
          snippet: 'Brain scans show activity across all regions',
        },
      ],
    },
    {
      id: 3,
      text: 'A new study found coffee cures cancer',
      verdict: 'unclear',
      confidence: 'low',
      explanation: 'No such study found in search results.',
      sources: [],
      what_to_check_next: 'Search for the specific study referenced',
    },
  ],
  transcript_preview:
    'Did you know that the Earth is 4.5 billion years old and we only use 10% of our brains?',
  cached: false,
};

const noTranscriptResponse = {
  status: 'no_transcript',
  metadata: { title: 'Dance Video #trending', channel: 'DancerPro' },
  overallScore: null,
  claims: [],
  transcript_preview: null,
  cached: false,
};

const errorResponse = {
  status: 'error',
  metadata: { title: '', channel: '' },
  overallScore: null,
  claims: [],
  transcript_preview: null,
  cached: false,
};

function buildResponse(videoId) {
  if (videoId === 'notranscript') {
    return { ...noTranscriptResponse, videoId };
  }
  if (videoId === 'error') {
    return { ...errorResponse, videoId };
  }
  return { ...successResponse, videoId };
}

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/analyze') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let videoId = 'unknown';
      try {
        const parsed = JSON.parse(body);
        videoId = parsed.videoId || 'unknown';
      } catch {
        // use default
      }

      const response = buildResponse(videoId);
      const statusCode = response.status === 'error' ? 500 : 200;

      // Simulate 1.5s backend latency
      setTimeout(() => {
        res.writeHead(statusCode, CORS_HEADERS);
        res.end(JSON.stringify(response));
      }, 1500);
    });
    return;
  }

  // Fallback for unknown routes
  res.writeHead(404, CORS_HEADERS);
  res.end(JSON.stringify({ error: 'Not found. Use POST /api/analyze' }));
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Mock server running on http://localhost:${PORT}`);
  console.log('');
  console.log('Routes:');
  console.log('  POST /api/analyze  { "videoId": "<id>" }');
  console.log('');
  console.log('Special videoId values:');
  console.log('  "notranscript"  -> returns no_transcript response');
  console.log('  "error"         -> returns error response (500)');
  console.log('  anything else   -> returns success response with 3 claims');
  console.log('');
  console.log('All responses have 1.5s simulated latency.');
});
