# Gemini Model Benchmark

## How to Run

1. Start the backend: `npm run dev` (in backend directory)
2. In another terminal, from the backend directory: `npm run benchmark`
3. Results are saved to `scripts/benchmark-results/`

**Note:** The benchmark must be run from your local terminal (not from Cursor's sandbox) so it can reach `http://127.0.0.1:3000`. If your backend runs on a different host/port, set `API_BASE`:
   ```bash
   API_BASE=http://localhost:3000 npm run benchmark
   ```

## What It Measures

- **Latency**: Per-step timing (fetchVideo, extractClaims, searchWeb, verifyClaims, total)
- **Token usage**: Input and output tokens per run (for cost)
- **Quality heuristics**: Claim count, overall score (rule-based)
- **Cost**: Per video, per 1k videos, per 10k videos

## Models Compared

| Model | Typical use |
|-------|-------------|
| gemini-2.5-flash-lite | Fastest, cheapest; may miss nuanced claims |
| gemini-2.5-flash | Balanced speed/cost/quality |
| gemini-3-flash-preview | Strong reasoning, contextual claim extraction |
| gemini-2.5-pro | Highest quality; slowest and most expensive |

## Recommendation Framework

Weighted score: **45% quality, 35% latency, 20% cost**

- **Primary recommendation**: Best overall weighted score
- **Fallback**: Second-best (use when latency or budget is constrained)

## Tradeoffs Summary

| Model | Speed | Cost | Quality | Best for |
|-------|-------|------|---------|----------|
| 2.5 Flash-Lite | Fastest | Lowest | Good | High volume, simple claims |
| 2.5 Flash | Fast | Low | Better | General use |
| 3 Flash | Medium | Medium | Best reasoning | Meta-claims, disclaimers |
| 2.5 Pro | Slowest | Highest | Highest | Maximum accuracy |

## Pricing (per 1M tokens, ai.google.dev)

- Flash-Lite: $0.10 input, $0.40 output
- 2.5 Flash: $0.30 input, $2.50 output
- 3 Flash: $0.50 input, $3.00 output
- 2.5 Pro: $1.25 input, $10.00 output
