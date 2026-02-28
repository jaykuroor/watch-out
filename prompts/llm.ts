import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// ── Types ──

export interface VerifiedClaim {
  id: number;
  text: string;
  verdict: 'supported' | 'refuted' | 'unclear';
  confidence: 'low' | 'med' | 'high';
  explanation: string;
  sources: { title: string; url: string; snippet: string }[];
  what_to_check_next?: string;
}

// ── LLM Call #1: Extract claims + search queries from transcript ──

export async function extractClaims(
  transcript: string,
  metadata: { title: string; channel: string }
): Promise<{ claims: string[]; searchQueries: string[] }> {
  const prompt = `You are a fact-checking assistant analyzing a short-form video transcript.

YOUR TASK:
1. Identify the top 1-3 FACTUAL claims made in this video. Only include claims that are:
   - Verifiable (not opinions, jokes, or subjective statements)
   - Specific enough to search for
   - Consequential (would matter if wrong)
2. Generate 1-2 search queries to help verify these claims. Queries should be neutral, factual, and what you'd type into Google to check the claims.

RULES:
- If the transcript is mostly opinion, entertainment, or personal anecdote with no verifiable claims, return empty arrays.
- Keep claims as short, direct sentences.
- Search queries should NOT repeat claims verbatim — they should target the underlying facts.

VIDEO METADATA:
Title: "${metadata.title}"
Channel: ${metadata.channel}

TRANSCRIPT (may be truncated):
${transcript.slice(0, 2000)}

Respond with ONLY valid JSON, no markdown backticks, no explanation:
{
  "claims": ["claim 1", "claim 2"],
  "searchQueries": ["query 1", "query 2"]
}`;

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 500,
        responseMimeType: 'application/json',
      },
    });

    const text = result.response.text();
    const parsed = JSON.parse(text);

    return {
      claims: (parsed.claims || []).slice(0, 3),
      searchQueries: (parsed.searchQueries || []).slice(0, 2),
    };
  } catch (error) {
    console.error('Gemini extractClaims error:', error);
    return { claims: [], searchQueries: [] };
  }
}

// ── LLM Call #2: Verify claims against search evidence ──

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
