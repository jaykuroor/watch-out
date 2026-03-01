import { NextRequest, NextResponse } from 'next/server';
import { fetchVideoData } from '@/app/lib/youtube';
import { searchWeb } from '@/app/lib/search';
import { extractClaims, verifyClaims, VerifiedClaim, type GeminiModelId, GEMINI_MODELS, DEFAULT_MODEL } from '@/app/lib/llm';
import { computeOverallScore } from '@/app/lib/scoring';

const cache = new Map<string, AnalysisResponse>();
const STAGE_BUDGETS = {
  fetchVideoMs: 15000,
  extractClaimsMs: 10000,
  searchQueryMs: 6000,
  verifyClaimsMs: 10000,
} as const;

function getStageBudgets(priority: string) {
  if (priority === 'low') {
    return {
      fetchVideoMs: 10000,
      extractClaimsMs: 7000,
      searchQueryMs: 4500,
      verifyClaimsMs: 7000,
      maxQueries: 2,
    } as const;
  }
  if (priority === 'medium') {
    return {
      fetchVideoMs: 12000,
      extractClaimsMs: 8500,
      searchQueryMs: 5500,
      verifyClaimsMs: 8500,
      maxQueries: 3,
    } as const;
  }
  return {
    ...STAGE_BUDGETS,
    maxQueries: 5,
  } as const;
}

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
    diagnostics?: {
      transcript?: { rawChars: number; cleanedChars: number; reducedChars: number; subtitleSource: string };
      extract?: { originalTranscriptChars: number; reducedTranscriptChars: number; transcriptWasReduced: boolean; timedOut: boolean };
      search?: { queryCount: number; timedOutQueries: number; failedQueries: number; totalResults: number };
      verify?: { rawEvidenceCount: number; selectedEvidenceCount: number; selectedEvidenceChars: number; timedOut: boolean };
      timeouts: { fetchVideo: boolean; extractClaims: boolean; verifyClaims: boolean };
    };
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
    const budgets = getStageBudgets(priority);
    const benchmark = body.benchmark === true;
    const forceRefresh = body.forceRefresh === true || body.noCache === true;
    const modelIdRaw = body.model as string | undefined;
    const modelId: GeminiModelId | undefined =
      modelIdRaw && modelIdRaw in GEMINI_MODELS ? (modelIdRaw as GeminiModelId) : undefined;

    if (!videoId || typeof videoId !== 'string') {
      return errorResponse('unknown', 'Missing or invalid videoId in request body', 400);
    }

    console.log(
      `[Analyze] Processing videoId: ${videoId}, priority: ${priority}` +
      `${benchmark ? ', benchmark=true' : ''}` +
      `${forceRefresh ? ', forceRefresh=true' : ''}` +
      `${modelId ? `, model=${modelId}` : ''}`
    );

    const cacheKey = benchmark || modelId ? `${videoId}:${modelId ?? 'default'}` : videoId;

    if (forceRefresh) {
      cache.delete(cacheKey);
      console.log(`[Analyze] Force refresh requested, bypassing cache for ${cacheKey}`);
    }

    // Check runtime cache (skip for benchmark/forceRefresh to ensure fresh runs)
    if (!benchmark && !forceRefresh && cache.has(cacheKey)) {
      console.log(`[Analyze] Returning cached result for ${cacheKey}`);
      return NextResponse.json({ ...cache.get(cacheKey), cached: true });
    }

    const t0 = Date.now();

    // Step 1: Fetch transcript + metadata via yt-dlp
    console.log(`[Analyze] Fetching video data via yt-dlp...`);
    const tFetchStart = Date.now();
    const { metadata, transcript } = await fetchVideoData(videoId, { timeoutMs: budgets.fetchVideoMs });
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
      cache.set(cacheKey, response);
      return NextResponse.json(response);
    }

    // Step 2: Extract claims + search queries (LLM call #1)
    console.log(`[Analyze] Extracting claims via Gemini...`);
    const tExtractStart = Date.now();
    const extractResult = await extractClaims(transcript.text, metadata, {
      modelId,
      timeoutMs: budgets.extractClaimsMs,
      transcriptBudgetChars: 6500,
    });
    const tExtractEnd = Date.now();
    const { claims, searchQueries, usage: extractUsage, diagnostics: extractDiagnostics } = extractResult;
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
            diagnostics: {
              ...(transcript.stats && { transcript: transcript.stats }),
              ...(extractDiagnostics && { extract: extractDiagnostics }),
              timeouts: {
                fetchVideo: false,
                extractClaims: extractDiagnostics?.timedOut ?? false,
                verifyClaims: false,
              },
            },
          },
        }),
      };
      if (!benchmark) cache.set(cacheKey, response);
      return NextResponse.json(response);
    }

    // Step 3: Web search for evidence (Tavily)
    console.log(`[Analyze] Searching web via Tavily...`);
    const tSearchStart = Date.now();
    const maxQueries = Math.min(budgets.maxQueries, claims.length <= 3 ? 3 : 5);
    const searchResult = await searchWeb(searchQueries, {
      maxQueries,
      timeoutMs: budgets.searchQueryMs,
      maxResultsPerQuery: 4,
    });
    const tSearchEnd = Date.now();
    const searchResults = searchResult.results;
    console.log(`[Analyze] Found ${searchResults.length} search results`);

    if (searchResults.length === 0) {
      const tTotal = Date.now() - t0;
      const response: AnalysisResponse = {
        videoId,
        status: 'error',
        metadata,
        overallScore: null,
        claims: [],
        transcript_preview: transcript.text.slice(0, 200),
        cached: false,
        error: 'No evidence sources were found for this video right now.',
        ...(benchmark && {
          benchmark: {
            modelId: modelId ?? DEFAULT_MODEL,
            timings: {
              fetchVideo: tFetchEnd - tFetchStart,
              extractClaims: tExtractEnd - tExtractStart,
              searchWeb: tSearchEnd - tSearchStart,
              verifyClaims: 0,
              total: tTotal,
            },
            diagnostics: {
              ...(transcript.stats && { transcript: transcript.stats }),
              ...(extractDiagnostics && { extract: extractDiagnostics }),
              search: searchResult.metrics,
              timeouts: {
                fetchVideo: false,
                extractClaims: extractDiagnostics?.timedOut ?? false,
                verifyClaims: false,
              },
            },
          },
        }),
      };
      return NextResponse.json(response);
    }

    // Step 4: Verify claims against evidence (LLM call #2)
    console.log(`[Analyze] Verifying claims via Gemini...`);
    const tVerifyStart = Date.now();
    const verifyResult = await verifyClaims(claims, searchResults, {
      modelId,
      timeoutMs: budgets.verifyClaimsMs,
    });
    const tVerifyEnd = Date.now();
    const verifiedClaims = verifyResult as VerifiedClaim[];
    const verifyUsage = (verifyResult as VerifiedClaim[] & { usage?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number } }).usage;
    const verifyDiagnostics = (verifyResult as VerifiedClaim[] & {
      diagnostics?: {
        rawEvidenceCount: number;
        selectedEvidenceCount: number;
        selectedEvidenceChars: number;
        timedOut: boolean;
      };
    }).diagnostics;
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
          diagnostics: {
            ...(transcript.stats && { transcript: transcript.stats }),
            ...(extractDiagnostics && { extract: extractDiagnostics }),
            search: searchResult.metrics,
            ...(verifyDiagnostics && { verify: verifyDiagnostics }),
            timeouts: {
              fetchVideo: false,
              extractClaims: extractDiagnostics?.timedOut ?? false,
              verifyClaims: verifyDiagnostics?.timedOut ?? false,
            },
          },
        },
      }),
    };

    if (!benchmark) cache.set(cacheKey, response);
    return NextResponse.json(response);

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Analyze] Pipeline failed for ${videoId}: ${msg}`);
    if (msg.includes('timed out') || msg.includes('timeout')) {
      console.warn(`[Analyze] Stage timeout detected for ${videoId}: ${msg}`);
    }
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
