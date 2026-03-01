// =============================================================
// Fact-checking LLM pipeline using Google Gemini
// =============================================================
// Two calls:
//   1. extractClaims: transcript → claims[] + searchQueries[] + contentType
//   2. verifyClaims: claims + search snippets → verdicts
//
// Uses gemini-2.0-flash (fast, cheap, good quality).
// Google AI free tier: 15 RPM, 1M tokens/day — plenty for hackathon.
// =============================================================

import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// ============================================
// LLM CALL #1: Extract claims + search queries
// ============================================

export interface ExtractionResult {
  claims: string[];
  searchQueries: string[];
  contentType: 'factual' | 'opinion' | 'entertainment' | 'personal';
  contentSummary: string; // 1-line description of what the video is about
}

export async function extractClaims(
  transcript: string,
  metadata: { title: string; channel: string }
): Promise<ExtractionResult> {
  const prompt = `You are a fact-checking assistant analyzing a short-form video transcript.

YOUR TASK:
1. Classify the content type of this video:
   - "factual": Makes specific verifiable claims (statistics, historical facts, scientific statements, "did you know" facts, causal claims like "X causes Y", attributed claims like "studies show...")
   - "opinion": Mostly personal opinions, hot takes, reviews, recommendations, or subjective commentary
   - "entertainment": Comedy, skits, music, memes, reactions, or pure entertainment with no factual assertions
   - "personal": Personal stories, vlogs, daily life, or anecdotes without broader factual claims

2. Write a 1-sentence summary of what this video is about (always do this regardless of content type).

3. If the video contains ANY verifiable factual claims (even if it's mostly opinion/entertainment), extract the top 1-3 claims. Include claims that are:
   - Verifiable against external sources (not pure opinion)
   - Specific enough to search for (has a concrete fact, number, name, or event)
   This includes statistics, historical claims, scientific statements, "did you know" facts, causal claims ("X causes Y"), and attributed claims ("studies show...").

4. Generate 1-2 search queries to verify the claims (only if claims were found).

RULES:
- Extract claims even if the video is mostly entertainment — many casual videos still contain checkable facts mixed in with opinions or storytelling.
- If a claim is IMPLIED rather than stated directly, rephrase it as an explicit factual statement (e.g., video says "this is why you should never microwave plastic" → claim: "Microwaving plastic releases harmful chemicals into food").
- Only return empty claims if there are truly ZERO verifiable facts in the transcript.
- Keep claims as short, direct sentences.
- Search queries should target the underlying facts, not repeat claims verbatim.
- contentSummary should be neutral and descriptive, not judgmental.

VIDEO METADATA:
Title: "${metadata.title}"
Channel: ${metadata.channel}

TRANSCRIPT (may be truncated):
${transcript.slice(0, 2000)}

Respond with ONLY valid JSON, no markdown backticks, no explanation:
{
  "contentType": "factual",
  "contentSummary": "One sentence describing the video content",
  "claims": ["claim 1", "claim 2"],
  "searchQueries": ["query 1", "query 2"]
}`;

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 600,
        responseMimeType: 'application/json',
      },
    });

    const text = result.response.text();
    const parsed = JSON.parse(text);

    const contentType = ['factual', 'opinion', 'entertainment', 'personal'].includes(
      parsed.contentType
    )
      ? parsed.contentType
      : 'factual';

    return {
      contentType,
      contentSummary: parsed.contentSummary || 'Short-form video content.',
      claims: (parsed.claims || []).slice(0, 3),
      searchQueries: (parsed.searchQueries || []).slice(0, 2),
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
  searchResults: { title: string; url: string; snippet: string }[]
): Promise<VerifiedClaim[]> {
  if (claims.length === 0) return [];

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
        maxOutputTokens: 800,
        responseMimeType: 'application/json',
      },
    });

    const text = result.response.text();
    const parsed = JSON.parse(text);
    const verdicts = parsed.verdicts || [];

    return claims.map((claim, i) => {
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