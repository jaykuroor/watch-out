# Benchmark Report (Sample)

Generated: Sample output structure. Run `npm run benchmark` with backend at localhost:3000 for live results.

## Latency (ms, mean)

| Model | Total | Extract | Verify | Search | Fetch |
|-------|-------|---------|--------|--------|-------|
| Gemini 2.5 Flash-Lite | ~15s | ~4s | ~6s | ~3s | ~2s |
| Gemini 2.5 Flash | ~20s | ~6s | ~8s | ~3s | ~2s |
| Gemini 3 Flash | ~25s | ~8s | ~10s | ~3s | ~2s |
| Gemini 2.5 Pro | ~35s | ~12s | ~15s | ~3s | ~2s |

## Token usage (mean per run)

| Model | Input tokens | Output tokens |
|-------|--------------|---------------|
| Gemini 2.5 Flash-Lite | ~800 | ~400 |
| Gemini 2.5 Flash | ~800 | ~500 |
| Gemini 3 Flash | ~800 | ~600 |
| Gemini 2.5 Pro | ~800 | ~700 |

## Cost analysis

Pricing source: ai.google.dev/gemini-api/docs/pricing (per 1M tokens)

| Model | Cost/video | Cost/1k videos | Cost/10k videos |
|-------|------------|----------------|-----------------|
| Gemini 2.5 Flash-Lite | $0.0005 | $0.50 | $5.00 |
| Gemini 2.5 Flash | $0.0015 | $1.50 | $15.00 |
| Gemini 3 Flash | $0.0023 | $2.30 | $23.00 |
| Gemini 2.5 Pro | $0.0080 | $8.00 | $80.00 |

## Quality heuristics (rule-based)

| Model | Avg claims | Avg score |
|-------|------------|-----------|
| Gemini 2.5 Flash-Lite | 3.2 | 0.72 |
| Gemini 2.5 Flash | 4.1 | 0.78 |
| Gemini 3 Flash | 5.0 | 0.82 |
| Gemini 2.5 Pro | 5.2 | 0.85 |

## Recommendation

Weighted: 45% quality, 35% latency, 20% cost

| Rank | Model | Weighted score |
|------|-------|----------------|
| 1 | Gemini 3 Flash | 78% |
| 2 | Gemini 2.5 Flash | 72% |
| 3 | Gemini 2.5 Flash-Lite | 65% |
| 4 | Gemini 2.5 Pro | 58% |

**Primary recommendation:** Gemini 3 Flash

**Fallback (if latency/cost matters):** Gemini 2.5 Flash

Tradeoffs: Flash-Lite is fastest/cheapest but may miss nuanced claims (e.g. disclaimers, meta-claims). Pro is highest quality but slowest/most expensive. 2.5 Flash and 3 Flash balance quality, speed, and cost. For your fact-checking extension with meta-claim detection, Gemini 3 Flash is recommended for best contextual understanding within reasonable latency and cost.
