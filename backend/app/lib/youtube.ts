// =============================================================
// YouTube data extraction
// =============================================================
// Fetches the YouTube watch page HTML for metadata and uses
// youtube-transcript library for reliable caption extraction.
// =============================================================

import { YoutubeTranscript } from 'youtube-transcript';

export interface VideoMetadata {
  title: string;
  channel: string;
}

export interface TranscriptResult {
  found: boolean;
  text: string;
}

export interface VideoData {
  metadata: VideoMetadata;
  transcript: TranscriptResult;
}

export async function fetchVideoData(videoId: string): Promise<VideoData> {
  // Fetch metadata and transcript in parallel
  const [metadata, transcript] = await Promise.all([
    fetchMetadata(videoId),
    fetchTranscript(videoId)
  ]);
  
  return { metadata, transcript };
}

async function fetchMetadata(videoId: string): Promise<VideoMetadata> {
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    const html = await response.text();
    return parseMetadata(html);
  } catch (error) {
    console.error('[YouTube] Failed to fetch metadata:', error);
    return { title: 'Unknown Title', channel: 'Unknown Channel' };
  }
}

function parseMetadata(html: string): VideoMetadata {
  const titleMatch = html.match(/<meta name="title" content="([^"]*)"/)
    || html.match(/"title":"([^"]*?)"/);
  const title = titleMatch ? decodeHTMLEntities(titleMatch[1]) : 'Unknown Title';

  const channelMatch = html.match(/"ownerChannelName":"([^"]*?)"/)
    || html.match(/<link itemprop="name" content="([^"]*)">/);
  const channel = channelMatch ? decodeHTMLEntities(channelMatch[1]) : 'Unknown Channel';

  return { title, channel };
}

async function fetchTranscript(videoId: string): Promise<TranscriptResult> {
  try {
    console.log(`[YouTube] Fetching transcript for ${videoId}...`);
    
    const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, {
      lang: 'en'
    });
    
    if (!transcriptItems || transcriptItems.length === 0) {
      console.log(`[YouTube] No transcript items found (YouTube may be blocking server-side requests)`);
      return { found: false, text: '' };
    }
    
    console.log(`[YouTube] Found ${transcriptItems.length} transcript segments`);
    
    const text = transcriptItems
      .map(item => item.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    console.log(`[YouTube] Transcript length: ${text.length} chars`);
    return { found: true, text };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`[YouTube] Transcript fetch failed: ${errorMessage}`);
    
    // Try without language preference as fallback
    try {
      const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
      
      if (!transcriptItems || transcriptItems.length === 0) {
        return { found: false, text: '' };
      }
      
      const text = transcriptItems
        .map(item => item.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      return { found: true, text };
    } catch {
      console.log(`[YouTube] All transcript fetch attempts failed - use demo mode for reliable results`);
      return { found: false, text: '' };
    }
  }
}

function decodeHTMLEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\u0026/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}
