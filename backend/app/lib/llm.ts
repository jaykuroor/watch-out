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

export const DEFAULT_MODEL: GeminiModelId = 'gemini-2.5-flash';

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

export async function extractClaims(
  transcript: string,
  metadata: { title: string; channel: string },
  options?: { modelId?: GeminiModelId }
): Promise<ExtractionResult & { usage?: TokenUsage }> {
  const modelId = options?.modelId ?? DEFAULT_MODEL;
  const model = getModel(modelId);
  const prompt = `You are a fact-checking assistant analyzing a video transcript. Read the ENTIRE transcript first to understand the full context and narrative arc.

YOUR TASK:
1. Classify the content type of this video:
   - "factual": Makes specific verifiable claims (statistics, historical facts, scientific statements, "did you know" facts, causal claims like "X causes Y", attributed claims like "studies show...")
   - "opinion": Mostly personal opinions, hot takes, reviews, recommendations, or subjective commentary
   - "entertainment": Comedy, skits, music, memes, reactions, or pure entertainment with no factual assertions
   - "personal": Personal stories, vlogs, daily life, or anecdotes without broader factual claims

2. Write a 1-sentence summary of what this video is about (always do this regardless of content type).

3. Extract up to 6 verifiable factual claims. Order claims by IMPORTANCE — the most significant claims first. Include claims that are:
   - Verifiable against external sources (not pure opinion)
   - Specific enough to search for (has a concrete fact, number, name, or event)
   This includes statistics, historical claims, scientific statements, "did you know" facts, causal claims ("X causes Y"), and attributed claims ("studies show...").

4. CRITICAL — Meta-claims and disclaimers: If the speaker makes claims that MODIFY, DISMISS, or CONTRADICT other claims in the video, treat those as the HIGHEST-PRIORITY claims. Examples:
   - "Don't believe any of this" or "None of this is true" → extract as the top claim (the speaker is disavowing prior factual content)
   - "Just kidding" or "I was joking" after factual statements → extract as a high-priority claim
   - Sarcasm that flips the meaning of prior claims → extract the actual intended claim
   - "This is satire" or "This is fiction" → extract as top claim
   Always consider the FULL context: a video that presents facts throughout but ends with a disclaimer has made the disclaimer the most important claim.

5. Generate up to 5 search queries to verify the claims (only if claims were found). Cover the most important claims first.

RULES:
- Read the whole transcript before extracting. Do not truncate your understanding.
- Extract claims even if the video is mostly entertainment — many casual videos still contain checkable facts mixed in with opinions or storytelling.
- If a claim is IMPLIED rather than stated directly, rephrase it as an explicit factual statement (e.g., video says "this is why you should never microwave plastic" → claim: "Microwaving plastic releases harmful chemicals into food").
- Only return empty claims if there are truly ZERO verifiable facts in the transcript.
- Keep claims as short, direct sentences.
- Search queries should target the underlying facts, not repeat claims verbatim.
- contentSummary should be neutral and descriptive, not judgmental.
- Prioritize the main aim of the video — avoid picking only weak tangential claims while missing the central thesis.

VIDEO METADATA:
Title: "${metadata.title}"
Channel: ${metadata.channel}

TRANSCRIPT (read the full text):
${transcript.slice(0, 12000)}

Respond with ONLY valid JSON, no markdown backticks, no explanation:
{
  "contentType": "factual",
  "contentSummary": "One sentence describing the video content",
  "claims": ["claim 1", "claim 2", "..."],
  "searchQueries": ["query 1", "query 2", "..."]
}`;

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    });

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
    };
  } catch (error) {
    console.error('Gemini extractClaims error:', error);
    return {
      contentType: 'factual',
      contentSummary: '',
      claims: [],
      searchQueries: [],
    };
  }
}

// ============================================
// LLM CALL #2: Verify claims against evidence
// ============================================

export async function verifyClaims(
  claims: string[],
  searchResults: { title: string; url: string; snippet: string }[],
  options?: { modelId?: GeminiModelId }
): Promise<VerifiedClaim[] & { usage?: TokenUsage }> {
  if (claims.length === 0) return [];

  const modelId = options?.modelId ?? DEFAULT_MODEL;
  const model = getModel(modelId);

  const prompt = `You are a fact-checking assistant. You will receive claims from a video and web search results as evidence.

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

SEARCH RESULTS:
${searchResults.map((r, i) => `[${i}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`).join('\n\n')}

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
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    });

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
        .filter((idx: number) => idx < searchResults.length)
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
    if (usage) Object.assign(verified, { usage });
    return verified;
  } catch (error) {
    console.error('Gemini verifyClaims error:', error);
    return claims.map((claim, i) => ({
      id: i + 1,
      text: claim,
      verdict: 'unclear' as const,
      confidence: 'low' as const,
      explanation: 'Verification failed — please try again.',
      sources: [],
      what_to_check_next: 'Try again or search manually.',
    }));
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