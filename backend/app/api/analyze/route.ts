import { NextRequest, NextResponse } from 'next/server';
import { fetchVideoData } from '@/app/lib/youtube';
import { searchWeb } from '@/app/lib/search';
import { extractClaims, verifyClaims, VerifiedClaim, type GeminiModelId, GEMINI_MODELS, DEFAULT_MODEL } from '@/app/lib/llm';
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
  /** Present when benchmark=true in request */
  benchmark?: {
    modelId: GeminiModelId;
    timings: { fetchVideo: number; extractClaims: number; searchWeb: number; verifyClaims: number; total: number };
    usage?: { extract: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number }; verify: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number } };
  };
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
    const benchmark = body.benchmark === true;
    const modelIdRaw = body.model as string | undefined;
    const modelId: GeminiModelId | undefined =
      modelIdRaw && modelIdRaw in GEMINI_MODELS ? (modelIdRaw as GeminiModelId) : undefined;

    if (!videoId || typeof videoId !== 'string') {
      return errorResponse('unknown', 'Missing or invalid videoId in request body', 400);
    }

    console.log(`[Analyze] Processing videoId: ${videoId}, priority: ${priority}${benchmark ? ', benchmark=true' : ''}${modelId ? `, model=${modelId}` : ''}`);

    const cacheKey = benchmark || modelId ? `${videoId}:${modelId ?? 'default'}` : videoId;

    // Check runtime cache (skip for benchmark to ensure fresh runs)
    if (!benchmark && cache.has(cacheKey)) {
      console.log(`[Analyze] Returning cached result for ${cacheKey}`);
      return NextResponse.json({ ...cache.get(cacheKey), cached: true });
    }

    const t0 = Date.now();

    // Step 1: Fetch transcript + metadata via yt-dlp
    console.log(`[Analyze] Fetching video data via yt-dlp...`);
    const tFetchStart = Date.now();
    const { metadata, transcript } = await fetchVideoData(videoId);
    const tFetchEnd = Date.now();
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
    const tExtractStart = Date.now();
    const extractResult = await extractClaims(transcript.text, metadata, { modelId });
    const tExtractEnd = Date.now();
    const { claims, searchQueries, usage: extractUsage } = extractResult;
    console.log(`[Analyze] Extracted ${claims.length} claims, ${searchQueries.length} search queries`);

    if (claims.length === 0) {
      const tTotal = Date.now() - t0;
      const response: AnalysisResponse = {
        videoId,
        status: 'success',
        metadata,
        overallScore: null,
        claims: [],
        transcript_preview: transcript.text.slice(0, 200),
        cached: false,
        ...(benchmark && {
          benchmark: {
            modelId: modelId ?? DEFAULT_MODEL,
            timings: {
              fetchVideo: tFetchEnd - tFetchStart,
              extractClaims: tExtractEnd - tExtractStart,
              searchWeb: 0,
              verifyClaims: 0,
              total: tTotal,
            },
            ...(extractUsage && { usage: { extract: extractUsage, verify: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 } } }),
          },
        }),
      };
      if (!benchmark) cache.set(cacheKey, response);
      return NextResponse.json(response);
    }

    // Step 3: Web search for evidence (Tavily)
    console.log(`[Analyze] Searching web via Tavily...`);
    const tSearchStart = Date.now();
    const searchResults = await searchWeb(searchQueries);
    const tSearchEnd = Date.now();
    console.log(`[Analyze] Found ${searchResults.length} search results`);

    // Step 4: Verify claims against evidence (LLM call #2)
    console.log(`[Analyze] Verifying claims via Gemini...`);
    const tVerifyStart = Date.now();
    const verifyResult = await verifyClaims(claims, searchResults, { modelId });
    const tVerifyEnd = Date.now();
    const verifiedClaims = verifyResult as VerifiedClaim[];
    const verifyUsage = (verifyResult as VerifiedClaim[] & { usage?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number } }).usage;
    console.log(`[Analyze] Verified ${verifiedClaims.length} claims`);

    // Step 5: Compute overall score
    const overallScore = computeOverallScore(verifiedClaims);
    console.log(`[Analyze] Overall score: ${overallScore}`);

    const tTotal = Date.now() - t0;

    const response: AnalysisResponse = {
      videoId,
      status: 'success',
      metadata,
      overallScore,
      claims: verifiedClaims,
      transcript_preview: transcript.text.slice(0, 200),
      cached: false,
      ...(benchmark && {
        benchmark: {
          modelId: modelId ?? DEFAULT_MODEL,
          timings: {
            fetchVideo: tFetchEnd - tFetchStart,
            extractClaims: tExtractEnd - tExtractStart,
            searchWeb: tSearchEnd - tSearchStart,
            verifyClaims: tVerifyEnd - tVerifyStart,
            total: tTotal,
          },
          ...(extractUsage && verifyUsage && {
            usage: { extract: extractUsage, verify: verifyUsage },
          }),
        },
      }),
    };

    if (!benchmark) cache.set(cacheKey, response);
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
