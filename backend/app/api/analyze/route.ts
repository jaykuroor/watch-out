import { NextRequest, NextResponse } from 'next/server';
import { fetchVideoData } from '@/app/lib/youtube';
import { searchWeb } from '@/app/lib/search';
import { extractClaims, verifyClaims, VerifiedClaim } from '@/app/lib/llm';
import { computeOverallScore } from '@/app/lib/scoring';

const cache = new Map<string, AnalysisResponse>();

interface AnalysisResponse {
  videoId: string;
  status: 'success' | 'no_transcript' | 'error';
  metadata: { title: string; channel: string };
  overallScore: number | null;
  claims: VerifiedClaim[];
  transcript_preview: string | null;
  cached: boolean;
  error?: string;
}

function errorResponse(videoId: string, error: string, status = 500) {
  return NextResponse.json(
    {
      videoId,
      status: 'error',
      metadata: { title: '', channel: '' },
      overallScore: null,
      claims: [],
      transcript_preview: null,
      cached: false,
      error,
    } satisfies AnalysisResponse,
    { status }
  );
}

export async function POST(req: NextRequest) {
  let videoId = 'unknown';

  try {
    const body = await req.json();
    videoId = body.videoId;
    const priority = body.priority || 'high';

    if (!videoId || typeof videoId !== 'string') {
      return errorResponse('unknown', 'Missing or invalid videoId in request body', 400);
    }

    console.log(`[Analyze] Processing videoId: ${videoId}, priority: ${priority}`);

    // Check runtime cache
    if (cache.has(videoId)) {
      console.log(`[Analyze] Returning cached result for ${videoId}`);
      return NextResponse.json({ ...cache.get(videoId), cached: true });
    }

    // Step 1: Fetch transcript + metadata via yt-dlp
    console.log(`[Analyze] Fetching video data via yt-dlp...`);
    const { metadata, transcript } = await fetchVideoData(videoId);
    console.log(`[Analyze] Metadata: "${metadata.title}" by ${metadata.channel}`);
    console.log(`[Analyze] Transcript found: ${transcript.found}, length: ${transcript.text.length}`);

    if (!transcript.found) {
      const response: AnalysisResponse = {
        videoId,
        status: 'no_transcript',
        metadata,
        overallScore: null,
        claims: [],
        transcript_preview: null,
        cached: false,
      };
      cache.set(videoId, response);
      return NextResponse.json(response);
    }

    // Step 2: Extract claims + search queries (LLM call #1)
    console.log(`[Analyze] Extracting claims via Gemini...`);
    const { claims, searchQueries } = await extractClaims(transcript.text, metadata);
    console.log(`[Analyze] Extracted ${claims.length} claims, ${searchQueries.length} search queries`);

    if (claims.length === 0) {
      const response: AnalysisResponse = {
        videoId,
        status: 'success',
        metadata,
        overallScore: null,
        claims: [],
        transcript_preview: transcript.text.slice(0, 200),
        cached: false,
      };
      cache.set(videoId, response);
      return NextResponse.json(response);
    }

    // Step 3: Web search for evidence (Tavily)
    console.log(`[Analyze] Searching web via Tavily...`);
    const searchResults = await searchWeb(searchQueries);
    console.log(`[Analyze] Found ${searchResults.length} search results`);

    // Step 4: Verify claims against evidence (LLM call #2)
    console.log(`[Analyze] Verifying claims via Gemini...`);
    const verifiedClaims = await verifyClaims(claims, searchResults);
    console.log(`[Analyze] Verified ${verifiedClaims.length} claims`);

    // Step 5: Compute overall score
    const overallScore = computeOverallScore(verifiedClaims);
    console.log(`[Analyze] Overall score: ${overallScore}`);

    const response: AnalysisResponse = {
      videoId,
      status: 'success',
      metadata,
      overallScore,
      claims: verifiedClaims,
      transcript_preview: transcript.text.slice(0, 200),
      cached: false,
    };

    cache.set(videoId, response);
    return NextResponse.json(response);

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Analyze] Pipeline failed for ${videoId}: ${msg}`);
    return errorResponse(videoId, msg);
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
