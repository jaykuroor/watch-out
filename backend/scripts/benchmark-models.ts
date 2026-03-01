/**
 * Benchmark script: compare Gemini models across videos.
 *
 * Run with: npx tsx scripts/benchmark-models.ts
 * Requires: backend running at http://localhost:3000 (npm run dev)
 *
 * Uses 5 videos, 4 models, 2 repeats per model/video. Results saved to
 * scripts/benchmark-results/raw-{timestamp}.json and report-{timestamp}.md
 */

const API_BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000';
const MODELS: (keyof typeof GEMINI_MODELS)[] = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
];

const GEMINI_MODELS: Record<string, string> = {
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-3-flash-preview': 'Gemini 3 Flash',
};

// 5 videos from prior testing (have captions + verifiable content)
const VIDEO_IDS = [
  'pWD6V9kRXBw', // How creatine works
  '9zuj5CxpJBI', // Donald Trump's religion
  'Ie2pk5Iyn1Q', // GTA 6 release
  'jej2TSkCKKo', // Laws of Physics Broken?
  'Amyrm_MdGzs'  // Is Sukuna stronger than gojo?
];

const REPEATS = 2;

/** Pricing per 1M tokens (input, output). Source: ai.google.dev/gemini-api/docs/pricing */
const PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
};

interface BenchmarkRun {
  videoId: string;
  modelId: string;
  repeat: number;
  status: string;
  timings?: { fetchVideo: number; extractClaims: number; searchWeb: number; verifyClaims: number; total: number };
  usage?: { extract: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number }; verify: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number } };
  claimCount?: number;
  overallScore?: number | null;
  error?: string;
}

async function analyze(videoId: string, modelId: string, benchmark: boolean): Promise<Record<string, unknown>> {
  const url = `${API_BASE}/api/analyze`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, benchmark, model: modelId }),
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    throw new Error(`fetch failed: ${err}. Is the backend running at ${API_BASE}?`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<Record<string, unknown>>;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function main() {
  console.log('Benchmark: 4 models x 5 videos x 2 repeats');
  console.log('API:', API_BASE);
  console.log('Models:', MODELS.join(', '));
  console.log('Videos:', VIDEO_IDS.join(', '));
  console.log('');

  const runs: BenchmarkRun[] = [];
  const order = shuffle([...MODELS]);

  for (const videoId of VIDEO_IDS) {
    for (const modelId of order) {
      for (let r = 0; r < REPEATS; r++) {
        process.stdout.write(`  ${videoId} @ ${modelId} (${r + 1}/${REPEATS})... `);
        try {
          const data = await analyze(videoId, modelId, true);
          const bench = data.benchmark as { timings?: BenchmarkRun['timings']; usage?: BenchmarkRun['usage']; modelId?: string } | undefined;
          const run: BenchmarkRun = {
            videoId,
            modelId,
            repeat: r + 1,
            status: data.status as string,
            timings: bench?.timings,
            usage: bench?.usage,
            claimCount: Array.isArray(data.claims) ? data.claims.length : undefined,
            overallScore: data.overallScore as number | null | undefined,
          };
          runs.push(run);
          console.log(`${bench?.timings?.total ?? 0}ms`);
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          runs.push({ videoId, modelId, repeat: r + 1, status: 'error', error: err });
          console.log('FAIL:', err.slice(0, 60));
        }
      }
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = `${process.cwd()}/scripts/benchmark-results`;
  const { mkdir, writeFile } = await import('fs/promises');
  await mkdir(outDir, { recursive: true });

  const rawPath = `${outDir}/raw-${timestamp}.json`;
  await writeFile(rawPath, JSON.stringify({ runs, timestamp }, null, 2));
  console.log('\nRaw results:', rawPath);

  // Aggregate and report
  const byModel = new Map<string, { totals: number[]; extracts: number[]; verifies: number[]; search: number[]; fetch: number[]; claims: number[]; scores: number[]; inputTokens: number[]; outputTokens: number[] }>();
  for (const run of runs) {
    if (run.status !== 'success' || !run.timings) continue;
    let m = byModel.get(run.modelId);
    if (!m) m = { totals: [], extracts: [], verifies: [], search: [], fetch: [], claims: [], scores: [], inputTokens: [], outputTokens: [] };
    m.totals.push(run.timings.total);
    m.extracts.push(run.timings.extractClaims);
    m.verifies.push(run.timings.verifyClaims);
    m.search.push(run.timings.searchWeb);
    m.fetch.push(run.timings.fetchVideo);
    if (run.claimCount != null) m.claims.push(run.claimCount);
    if (run.overallScore != null) m.scores.push(run.overallScore);
    if (run.usage) {
      m.inputTokens.push(run.usage.extract.promptTokenCount + run.usage.verify.promptTokenCount);
      m.outputTokens.push(run.usage.extract.candidatesTokenCount + run.usage.verify.candidatesTokenCount);
    }
    byModel.set(run.modelId, m);
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const lines: string[] = [
    '# Benchmark Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Latency (ms, mean)',
    '',
    '| Model | Total | Extract | Verify | Search | Fetch |',
    '|-------|-------|---------|--------|--------|-------|',
  ];

  for (const modelId of MODELS) {
    const m = byModel.get(modelId);
    if (!m) continue;
    lines.push(`| ${GEMINI_MODELS[modelId] ?? modelId} | ${Math.round(avg(m.totals))} | ${Math.round(avg(m.extracts))} | ${Math.round(avg(m.verifies))} | ${Math.round(avg(m.search))} | ${Math.round(avg(m.fetch))} |`);
  }

  lines.push('', '## Token usage (mean per run)', '', '| Model | Input tokens | Output tokens |');
  for (const modelId of MODELS) {
    const m = byModel.get(modelId);
    if (!m || !m.inputTokens.length) continue;
    lines.push(`| ${GEMINI_MODELS[modelId] ?? modelId} | ${Math.round(avg(m.inputTokens))} | ${Math.round(avg(m.outputTokens))} |`);
  }

  // Cost analysis
  lines.push('', '## Cost analysis', '', 'Pricing source: ai.google.dev/gemini-api/docs/pricing (per 1M tokens)', '');
  lines.push('| Model | Cost/video | Cost/1k videos | Cost/10k videos |');
  const costPerModel = new Map<string, number>();
  for (const modelId of MODELS) {
    const m = byModel.get(modelId);
    const p = PRICING[modelId];
    if (!m || !m.inputTokens.length || !p) continue;
    const inp = avg(m.inputTokens) / 1_000_000 * p.input;
    const out = avg(m.outputTokens) / 1_000_000 * p.output;
    const cost = inp + out;
    costPerModel.set(modelId, cost);
    lines.push(`| ${GEMINI_MODELS[modelId] ?? modelId} | $${cost.toFixed(4)} | $${(cost * 1000).toFixed(2)} | $${(cost * 10000).toFixed(2)} |`);
  }

  // Quality heuristics (rule-based): claim count + score
  lines.push('', '## Quality heuristics (rule-based)', '', '| Model | Avg claims | Avg score |');
  for (const modelId of MODELS) {
    const m = byModel.get(modelId);
    if (!m) continue;
    const claimsAvg = m.claims.length ? avg(m.claims).toFixed(1) : '-';
    const scoreAvg = m.scores.length ? avg(m.scores).toFixed(2) : '-';
    lines.push(`| ${GEMINI_MODELS[modelId] ?? modelId} | ${claimsAvg} | ${scoreAvg} |`);
  }

  // Recommendation: weighted score (45% quality, 35% latency, 20% cost)
  const totals = [...byModel.entries()].filter(([, m]) => m.totals.length > 0);
  if (totals.length > 0) {
    const maxTotal = Math.max(...totals.map(([, m]) => avg(m.totals)));
    const minTotal = Math.min(...totals.map(([, m]) => avg(m.totals)));
    const maxCost = Math.max(...totals.map(([id]) => costPerModel.get(id) ?? 0));
    const minCost = Math.min(...totals.filter(([id]) => costPerModel.has(id)).map(([id]) => costPerModel.get(id)!));
    const maxClaims = Math.max(...totals.map(([, m]) => (m.claims.length ? avg(m.claims) : 0)));
    const maxScores = Math.max(...totals.map(([, m]) => (m.scores.length ? avg(m.scores) : 0)));

    const scores = totals.map(([modelId, m]) => {
      const latencyNorm = maxTotal === minTotal ? 1 : 1 - (avg(m.totals) - minTotal) / (maxTotal - minTotal);
      const costNorm = maxCost === minCost ? 1 : 1 - ((costPerModel.get(modelId) ?? 0) - minCost) / (maxCost - minCost);
      const claimNorm = maxClaims ? (m.claims.length ? avg(m.claims) / maxClaims : 0) : 0;
      const scoreNorm = maxScores ? (m.scores.length ? avg(m.scores) / maxScores : 0) : 0;
      const qualityNorm = (claimNorm + scoreNorm) / 2;
      const weighted = 0.45 * qualityNorm + 0.35 * latencyNorm + 0.2 * costNorm;
      return { modelId, weighted, latencyNorm, costNorm, qualityNorm };
    });
    scores.sort((a, b) => b.weighted - a.weighted);

    lines.push('', '## Recommendation', '', 'Weighted: 45% quality, 35% latency, 20% cost', '');
    lines.push('| Rank | Model | Weighted score |');
    scores.forEach((s, i) => {
      lines.push(`| ${i + 1} | ${GEMINI_MODELS[s.modelId] ?? s.modelId} | ${(s.weighted * 100).toFixed(1)}% |`);
    });
    const rec = scores[0];
    const fallback = scores[1];
    lines.push('', `**Primary recommendation:** ${GEMINI_MODELS[rec.modelId] ?? rec.modelId}`, '');
    lines.push(`**Fallback (if latency/cost matters):** ${fallback ? GEMINI_MODELS[fallback.modelId] ?? fallback.modelId : 'N/A'}`, '');
    lines.push('', 'Tradeoffs: Flash-Lite is fastest/cheapest but may miss nuanced claims. Pro is highest quality but slowest/most expensive. 2.5 Flash and 3 Flash balance quality, speed, and cost.', '');
  }

  const reportPath = `${outDir}/report-${timestamp}.md`;
  await writeFile(reportPath, lines.join('\n'));
  console.log('Report:', reportPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
