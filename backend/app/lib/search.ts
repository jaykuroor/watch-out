// =============================================================
// Web search via Tavily
// =============================================================
// Tavily returns clean pre-extracted snippets (unlike Google which
// returns HTML). This is much more LLM-friendly.
// Free tier: 1000 searches/month — more than enough for hackathon.
// Sign up: https://tavily.com
// =============================================================

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchMetrics {
  queryCount: number;
  timedOutQueries: number;
  failedQueries: number;
  totalResults: number;
}

export interface SearchWebResult {
  results: SearchResult[];
  metrics: SearchMetrics;
}

export async function searchWeb(
  queries: string[],
  options?: { maxQueries?: number; timeoutMs?: number; maxResultsPerQuery?: number }
): Promise<SearchWebResult> {
  const maxQueries = options?.maxQueries ?? 5;
  const timeoutMs = options?.timeoutMs ?? 6000;
  const maxResultsPerQuery = options?.maxResultsPerQuery ?? 4;

  const limitedQueries = queries.slice(0, maxQueries);
  const searches = limitedQueries.map(async (query) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query,
          search_depth: 'basic',        // faster than 'advanced'
          max_results: maxResultsPerQuery,
          include_answer: false,
          include_raw_content: false
        })
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.error(`Tavily search failed for "${query}": ${response.status}`);
        return { results: [] as SearchResult[], timedOut: false, failed: true };
      }

      const data = await response.json();
      return {
        results: (data.results || []).map((r: TavilyResult) => ({
        title: r.title || '',
        url: r.url || '',
        snippet: (r.content || '').slice(0, 300)
        })),
        timedOut: false,
        failed: false,
      };
    } catch (error) {
      clearTimeout(timeout);
      const timedOut = error instanceof Error && error.name === 'AbortError';
      console.error(`Tavily search error for "${query}":`, error);
      return { results: [] as SearchResult[], timedOut, failed: !timedOut };
    }
  });

  const settled = await Promise.allSettled(searches);
  const responses = settled
    .map((item) =>
      item.status === 'fulfilled'
        ? item.value
        : { results: [] as SearchResult[], timedOut: false, failed: true }
    );

  const results = responses.flatMap((r) => r.results);
  return {
    results,
    metrics: {
      queryCount: limitedQueries.length,
      timedOutQueries: responses.filter((r) => r.timedOut).length,
      failedQueries: responses.filter((r) => r.failed).length,
      totalResults: results.length,
    },
  };
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}
