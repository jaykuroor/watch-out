// =============================================================
// Compute the overall verification score (0.0 – 1.0)
// =============================================================
// Weighted average of claim verdicts.
// Weight by confidence: high=3, med=2, low=1
// Verdict scores: supported=1.0, unclear=0.5, refuted=0.0
// =============================================================

export interface ScoredClaim {
  verdict: 'supported' | 'refuted' | 'unclear';
  confidence: 'low' | 'med' | 'high';
}

const VERDICT_SCORE: Record<string, number> = {
  supported: 1.0,
  unclear: 0.5,
  refuted: 0.0
};

const CONFIDENCE_WEIGHT: Record<string, number> = {
  low: 1,
  med: 2,
  high: 3
};

export function computeOverallScore(claims: ScoredClaim[]): number {
  if (claims.length === 0) return 0.5; // neutral default

  let totalWeight = 0;
  let weightedSum = 0;

  for (const claim of claims) {
    const weight = CONFIDENCE_WEIGHT[claim.confidence] || 1;
    const score = VERDICT_SCORE[claim.verdict] ?? 0.5;
    weightedSum += score * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : 0.5;
}
