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

export async function searchWeb(queries: string[]): Promise<SearchResult[]> {
  // Cap at 5 queries to support up to 10 claims
  const limitedQueries = queries.slice(0, 5);

  // Run searches in parallel
  const searches = limitedQueries.map(async (query) => {
    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query,
          search_depth: 'basic',        // faster than 'advanced'
          max_results: 5,
          include_answer: false,
          include_raw_content: false
        })
      });

      if (!response.ok) {
        console.error(`Tavily search failed for "${query}": ${response.status}`);
        return [];
      }

      const data = await response.json();
      return (data.results || []).map((r: TavilyResult) => ({
        title: r.title || '',
        url: r.url || '',
        snippet: (r.content || '').slice(0, 300)
      }));
    } catch (error) {
      console.error(`Tavily search error for "${query}":`, error);
      return [];
    }
  });

  const allResults = await Promise.all(searches);
  return allResults.flat();
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}
