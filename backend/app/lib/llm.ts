// =============================================================
// Fact-checking LLM pipeline using Google Gemini
// =============================================================
// Two calls:
//   1. extractClaims: transcript → claims[] + searchQueries[] + contentType
//   2. verifyClaims: claims + search snippets → verdicts
//
// Uses gemini-3-flash-preview (powerful reasoning for contextual claim extraction).
// Supports runtime model override for benchmarking.
// =============================================================

import { GoogleGenerativeAI } from '@google/generative-ai';
import { jsonrepair } from 'jsonrepair';

/** Supported Gemini model IDs for fact-checking pipeline. */
export const GEMINI_MODELS = {
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-3-flash-preview': 'Gemini 3 Flash',
} as const;

export type GeminiModelId = keyof typeof GEMINI_MODELS;

export const DEFAULT_MODEL: GeminiModelId = 'gemini-2.5-flash-lite';

/** Parse LLM JSON output robustly. Strips markdown blocks and repairs malformed JSON. */
function parseJson<T>(text: string): T {
  let cleaned = text.trim();
  // Strip markdown code blocks if present
  const codeBlockMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (codeBlockMatch) cleaned = codeBlockMatch[1].trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return JSON.parse(jsonrepair(cleaned)) as T;
  }
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);

function getModel(modelId: GeminiModelId = DEFAULT_MODEL) {
  return genAI.getGenerativeModel({ model: modelId });
}

// ============================================
// LLM CALL #1: Extract claims + search queries
// ============================================

export interface ExtractionResult {
  claims: string[];
  searchQueries: string[];
  contentType: 'factual' | 'opinion' | 'entertainment' | 'personal';
  contentSummary: string; // 1-line description of what the video is about
}

export interface TokenUsage {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

interface ExtractionDiagnostics {
  originalTranscriptChars: number;
  reducedTranscriptChars: number;
  transcriptWasReduced: boolean;
  timedOut: boolean;
}

interface VerifyDiagnostics {
  rawEvidenceCount: number;
  selectedEvidenceCount: number;
  selectedEvidenceChars: number;
  timedOut: boolean;
}

const EXTRACT_TRANSCRIPT_BUDGET_CHARS = 6500;
const EXTRACT_TIMEOUT_MS = 10000;
const VERIFY_TIMEOUT_MS = 10000;

export async function extractClaims(
  transcript: string,
  metadata: { title: string; channel: string },
  options?: { modelId?: GeminiModelId; timeoutMs?: number; transcriptBudgetChars?: number }
): Promise<ExtractionResult & { usage?: TokenUsage; diagnostics?: ExtractionDiagnostics }> {
  const modelId = options?.modelId ?? DEFAULT_MODEL;
  const timeoutMs = options?.timeoutMs ?? EXTRACT_TIMEOUT_MS;
  const transcriptBudgetChars = options?.transcriptBudgetChars ?? EXTRACT_TRANSCRIPT_BUDGET_CHARS;
  const model = getModel(modelId);
  const reducedTranscript = reduceTranscriptForExtraction(transcript, transcriptBudgetChars);
  const prompt = `You are a fact-checking assistant analyzing a video transcript.

YOUR TASK:
1. Classify the content type of this video:
   - "factual": Makes specific verifiable claims (statistics, historical facts, scientific statements, "did you know" facts, causal claims like "X causes Y", attributed claims like "studies show...")
   - "opinion": Mostly personal opinions, hot takes, reviews, recommendations, or subjective commentary
   - "entertainment": Comedy, skits, music, memes, reactions, or pure entertainment with no factual assertions
   - "personal": Personal stories, vlogs, daily life, or anecdotes without broader factual claims

2. Write a 1-sentence summary of what this video is about (always do this regardless of content type).

3. Extract up to 6 verifiable factual claims. Order by IMPORTANCE.
   Claims must be:
   - Verifiable against external sources (not pure opinion)
   - Specific enough to search for (has a concrete fact, number, name, or event)
   Include statistics, historical/scientific claims, causal claims, and attributed claims ("studies show...").

4. CRITICAL: Meta-claims/disclaimers that modify, dismiss, or contradict prior statements are highest-priority.
   Examples: "none of this is true", "just kidding", "this is satire/fiction".
   If disclaimer appears at the end, treat it as most important context.

5. Generate up to 5 search queries to verify the claims (only if claims were found). Cover the most important claims first.

RULES:
- Use the full provided transcript context before extracting.
- Extract claims even if the video is mostly entertainment — many casual videos still contain checkable facts mixed in with opinions or storytelling.
- If a claim is IMPLIED rather than stated directly, rephrase it as an explicit factual statement (e.g., video says "this is why you should never microwave plastic" → claim: "Microwaving plastic releases harmful chemicals into food").
- Only return empty claims if there are truly ZERO verifiable facts in the transcript.
- Keep claims as short, direct sentences.
- Only extract claims that are significantly different than each other. Don't extract many claims if there aren't many significant differences.
- Search queries should target the underlying facts, not repeat claims verbatim.
- contentSummary should be neutral and descriptive, not judgmental.
- Prioritize the main aim of the video — avoid picking only weak tangential claims while missing the central thesis.

VIDEO METADATA:
Title: "${metadata.title}"
Channel: ${metadata.channel}

TRANSCRIPT (read the full text):
${reducedTranscript}

Respond with ONLY valid JSON, no markdown backticks, no explanation:
{
  "contentType": "factual",
  "contentSummary": "One sentence describing the video content",
  "claims": ["claim 1", "claim 2", "..."],
  "searchQueries": ["query 1", "query 2", "..."]
}`;

  try {
    const result = await withTimeout(
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1200,
          responseMimeType: 'application/json',
        },
      }),
      timeoutMs,
      'extractClaims timeout'
    );

    const usage: TokenUsage | undefined = (result.response as { usageMetadata?: TokenUsage }).usageMetadata
      ? {
          promptTokenCount: (result.response as { usageMetadata?: TokenUsage }).usageMetadata!.promptTokenCount ?? 0,
          candidatesTokenCount: (result.response as { usageMetadata?: TokenUsage }).usageMetadata!.candidatesTokenCount ?? 0,
          totalTokenCount: (result.response as { usageMetadata?: TokenUsage }).usageMetadata!.totalTokenCount ?? 0,
        }
      : undefined;

    const text = result.response.text();
    const parsed = parseJson<{
      contentType?: string;
      contentSummary?: string;
      claims?: string[];
      searchQueries?: string[];
    }>(text);

    const rawContentType = parsed.contentType ?? '';
    const contentType = ['factual', 'opinion', 'entertainment', 'personal'].includes(rawContentType)
      ? (rawContentType as 'factual' | 'opinion' | 'entertainment' | 'personal')
      : 'factual';

    return {
      contentType,
      contentSummary: parsed.contentSummary || 'Short-form video content.',
      claims: (parsed.claims || []).slice(0, 10),
      searchQueries: (parsed.searchQueries || []).slice(0, 5),
      ...(usage && { usage }),
      diagnostics: {
        originalTranscriptChars: transcript.length,
        reducedTranscriptChars: reducedTranscript.length,
        transcriptWasReduced: reducedTranscript.length < transcript.length,
        timedOut: false,
      },
    };
  } catch (error) {
    console.error('Gemini extractClaims error:', error);
    const timedOut = error instanceof Error && error.message.includes('extractClaims timeout');
    return {
      contentType: 'factual',
      contentSummary: '',
      claims: [],
      searchQueries: [],
      diagnostics: {
        originalTranscriptChars: transcript.length,
        reducedTranscriptChars: reducedTranscript.length,
        transcriptWasReduced: reducedTranscript.length < transcript.length,
        timedOut,
      },
    };
  }
}

// ============================================
// LLM CALL #2: Verify claims against evidence
// ============================================

export async function verifyClaims(
  claims: string[],
  searchResults: { title: string; url: string; snippet: string }[],
  options?: { modelId?: GeminiModelId; timeoutMs?: number }
): Promise<VerifiedClaim[] & { usage?: TokenUsage; diagnostics?: VerifyDiagnostics }> {
  if (claims.length === 0) return [];

  const modelId = options?.modelId ?? DEFAULT_MODEL;
  const timeoutMs = options?.timeoutMs ?? VERIFY_TIMEOUT_MS;
  const model = getModel(modelId);
  const evidence = selectEvidenceForVerification(claims, searchResults, {
    maxEvidenceItems: 12,
    maxEvidenceChars: 3600,
    maxPerClaim: 3,
  });
  const evidenceIndexToOriginal = new Map<number, number>();
  evidence.items.forEach((item) => evidenceIndexToOriginal.set(item.evidenceIndex, item.originalIndex));
  const formattedEvidence = evidence.items
    .map((item) => `{"i":${item.evidenceIndex},"u":"${escapeJsonLine(item.url)}","s":"${escapeJsonLine(item.snippet)}"}`)
    .join(',\n');

  if (evidence.items.length === 0) {
    const fallback = claims.map((claim, i) => ({
      id: i + 1,
      text: claim,
      verdict: 'unclear' as const,
      confidence: 'low' as const,
      explanation: 'No relevant evidence snippets were available for this claim.',
      sources: [],
      what_to_check_next: 'Try searching this claim with specific names, dates, or numbers.',
    }));
    Object.assign(fallback, {
      diagnostics: {
        rawEvidenceCount: searchResults.length,
        selectedEvidenceCount: 0,
        selectedEvidenceChars: 0,
        timedOut: false,
      } satisfies VerifyDiagnostics,
    });
    return fallback;
  }

  const prompt = `You are a fact-checking assistant. You will receive claims and evidence snippets.

For each claim, determine a verdict:
- "supported": Search results contain evidence that DIRECTLY supports this claim
- "refuted": Credible sources CONTRADICT this claim
- "unclear": Not enough evidence, or claim is too vague to verify

RULES:
- Be conservative. Weak or indirect evidence = "unclear".
- confidence: "high" only if multiple credible sources agree. "low" if extrapolating.
- Cite sources by their index number.
- Keep explanations to 1-2 sentences.
- For "unclear" verdicts, include "what_to_check_next" (a 1-line suggestion).

CLAIMS:
${claims.map((c, i) => `[${i}] ${c}`).join('\n')}

EVIDENCE (JSON lines with source index "i", url "u", snippet "s"):
[
${formattedEvidence}
]

Respond with ONLY valid JSON, no markdown backticks:
{
  "verdicts": [
    {
      "claim_index": 0,
      "verdict": "supported",
      "confidence": "high",
      "explanation": "Brief explanation of the evidence",
      "source_indices": [0, 2],
      "what_to_check_next": null
    }
  ]
}`;

  try {
    const result = await withTimeout(
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1600,
          responseMimeType: 'application/json',
        },
      }),
      timeoutMs,
      'verifyClaims timeout'
    );

    const usage: TokenUsage | undefined = (result.response as { usageMetadata?: TokenUsage }).usageMetadata
      ? {
          promptTokenCount: (result.response as { usageMetadata?: TokenUsage }).usageMetadata!.promptTokenCount ?? 0,
          candidatesTokenCount: (result.response as { usageMetadata?: TokenUsage }).usageMetadata!.candidatesTokenCount ?? 0,
          totalTokenCount: (result.response as { usageMetadata?: TokenUsage }).usageMetadata!.totalTokenCount ?? 0,
        }
      : undefined;

    const text = result.response.text();
    const parsed = parseJson<{ verdicts?: Array<{
      claim_index: number;
      verdict: string;
      confidence: string;
      explanation?: string;
      source_indices?: number[];
      what_to_check_next?: string | null;
    }> }>(text);
    const verdicts = parsed.verdicts || [];

    const verified = claims.map((claim, i) => {
      const v = verdicts.find((vd: { claim_index: number }) => vd.claim_index === i) || {
        verdict: 'unclear',
        confidence: 'low',
        explanation: 'Could not verify this claim with available evidence.',
        source_indices: [],
        what_to_check_next: 'Try searching for this claim directly.',
      };

      const sources = (v.source_indices || [])
        .map((idx: number) => evidenceIndexToOriginal.get(idx))
        .filter((idx): idx is number => typeof idx === 'number' && idx < searchResults.length)
        .slice(0, 3)
        .map((idx: number) => searchResults[idx]);

      return {
        id: i + 1,
        text: claim,
        verdict: v.verdict as 'supported' | 'refuted' | 'unclear',
        confidence: v.confidence as 'low' | 'med' | 'high',
        explanation: v.explanation || '',
        sources,
        what_to_check_next:
          v.verdict === 'unclear' ? v.what_to_check_next || undefined : undefined,
      };
    });
    Object.assign(verified, {
      ...(usage && { usage }),
      diagnostics: {
        rawEvidenceCount: searchResults.length,
        selectedEvidenceCount: evidence.items.length,
        selectedEvidenceChars: evidence.totalChars,
        timedOut: false,
      } satisfies VerifyDiagnostics,
    });
    return verified;
  } catch (error) {
    console.error('Gemini verifyClaims error:', error);
    const timedOut = error instanceof Error && error.message.includes('verifyClaims timeout');
    const fallback = claims.map((claim, i) => ({
      id: i + 1,
      text: claim,
      verdict: 'unclear' as const,
      confidence: 'low' as const,
      explanation: 'Verification failed — please try again.',
      sources: [],
      what_to_check_next: 'Try again or search manually.',
    }));
    Object.assign(fallback, {
      diagnostics: {
        rawEvidenceCount: searchResults.length,
        selectedEvidenceCount: evidence.items.length,
        selectedEvidenceChars: evidence.totalChars,
        timedOut,
      } satisfies VerifyDiagnostics,
    });
    return fallback;
  }
}

function reduceTranscriptForExtraction(transcript: string, maxChars: number): string {
  if (transcript.length <= maxChars) return transcript;
  if (maxChars < 1000) return transcript.slice(0, maxChars);

  const headChars = Math.floor(maxChars * 0.35);
  const tailChars = Math.floor(maxChars * 0.35);
  const middleChars = Math.max(0, maxChars - headChars - tailChars);

  const head = transcript.slice(0, headChars).trim();
  const tail = transcript.slice(-tailChars).trim();

  const middleSourceStart = Math.floor((transcript.length - middleChars) / 2);
  const middleSource = transcript.slice(middleSourceStart, middleSourceStart + middleChars * 2);
  const middle = sampleMiddleSegments(middleSource, middleChars).trim();

  return [head, middle, tail].filter(Boolean).join('\n...\n');
}

function sampleMiddleSegments(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const part = Math.floor(budget / 2);
  const first = text.slice(0, part).trim();
  const second = text.slice(-part).trim();
  return `${first}\n...\n${second}`;
}

function selectEvidenceForVerification(
  claims: string[],
  searchResults: { title: string; url: string; snippet: string }[],
  limits: { maxEvidenceItems: number; maxEvidenceChars: number; maxPerClaim: number }
): { items: Array<{ evidenceIndex: number; originalIndex: number; url: string; snippet: string }>; totalChars: number } {
  const deduped = dedupeEvidence(searchResults).map((item, index) => ({ ...item, dedupedIndex: index }));
  const selectedIndices = new Set<number>();

  for (const claim of claims) {
    const ranked = deduped
      .map((item) => ({
        item,
        score: evidenceRelevanceScore(claim, `${item.title} ${item.snippet}`),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limits.maxPerClaim);

    for (const match of ranked) {
      selectedIndices.add(match.item.dedupedIndex);
    }
  }

  let selected = [...selectedIndices]
    .sort((a, b) => a - b)
    .map((idx) => deduped[idx])
    .slice(0, limits.maxEvidenceItems);

  // If overlap scoring misses everything but search returned data, keep a tiny fallback subset.
  if (selected.length === 0 && deduped.length > 0) {
    selected = deduped.slice(0, Math.min(3, limits.maxEvidenceItems));
  }

  let totalChars = 0;
  const bounded: Array<{ evidenceIndex: number; originalIndex: number; url: string; snippet: string }> = [];
  let evidenceIndex = 0;
  for (const item of selected) {
    const nextChars = item.url.length + item.snippet.length;
    if (totalChars + nextChars > limits.maxEvidenceChars) continue;
    bounded.push({
      evidenceIndex,
      originalIndex: item.originalIndex,
      url: item.url,
      snippet: item.snippet,
    });
    totalChars += nextChars;
    evidenceIndex += 1;
  }
  return { items: bounded, totalChars };
}

function dedupeEvidence(searchResults: { title: string; url: string; snippet: string }[]) {
  const seenUrl = new Set<string>();
  const seenSnippet = new Set<string>();
  const deduped: Array<{ originalIndex: number; title: string; url: string; snippet: string }> = [];

  for (let i = 0; i < searchResults.length; i += 1) {
    const item = searchResults[i];
    const urlKey = normalizeUrl(item.url);
    const snippetKey = normalizeText(item.snippet);
    if (!item.url || !item.snippet) continue;
    if (seenUrl.has(urlKey) || seenSnippet.has(snippetKey)) continue;
    seenUrl.add(urlKey);
    seenSnippet.add(snippetKey);
    deduped.push({
      originalIndex: i,
      title: item.title || '',
      url: item.url,
      snippet: item.snippet.slice(0, 220),
    });
  }

  return deduped;
}

function evidenceRelevanceScore(claim: string, evidenceText: string): number {
  const claimTokens = tokenize(claim);
  if (claimTokens.length === 0) return 0;
  const evidenceTokens = new Set(tokenize(evidenceText));
  let overlap = 0;
  for (const token of claimTokens) {
    if (evidenceTokens.has(token)) overlap += 1;
  }
  return overlap / claimTokens.length;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '');
}

function escapeJsonLine(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface VerifiedClaim {
  id: number;
  text: string;
  verdict: 'supported' | 'refuted' | 'unclear';
  confidence: 'low' | 'med' | 'high';
  explanation: string;
  sources: { title: string; url: string; snippet: string }[];
  what_to_check_next?: string;
}