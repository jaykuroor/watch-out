// =============================================================
// YouTube data extraction via yt-dlp
// =============================================================
// Single yt-dlp call fetches both metadata (info.json) and
// subtitles (VTT file). VTT is parsed to lean plain text
// to minimise LLM token usage.
// Requires: yt-dlp installed on PATH.
// =============================================================

import { execFile } from 'child_process';
import { readFile, readdir, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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
  const tempDir = join(tmpdir(), 'watchout', videoId);
  await mkdir(tempDir, { recursive: true });

  try {
    await execFileAsync('yt-dlp', [
      '--write-subs', '--write-auto-subs',
      '--sub-lang', 'en',
      '--sub-format', 'vtt',
      '--skip-download',
      '--write-info-json',
      '--no-warnings',
      '-o', join(tempDir, '%(id)s'),
      `https://www.youtube.com/shorts/${videoId}`,
    ], { timeout: 30000 });

    const files = await readdir(tempDir);

    // Parse metadata from info.json
    const infoFile = files.find(f => f.endsWith('.info.json'));
    let metadata: VideoMetadata = { title: 'Unknown Title', channel: 'Unknown Channel' };
    if (infoFile) {
      try {
        const raw = await readFile(join(tempDir, infoFile), 'utf-8');
        const info = JSON.parse(raw);
        metadata = {
          title: info.title || 'Unknown Title',
          channel: info.channel || info.uploader || 'Unknown Channel',
        };
      } catch {
        console.error('[yt-dlp] Failed to parse info.json');
      }
    }

    console.log(`[yt-dlp] Metadata: "${metadata.title}" by ${metadata.channel}`);

    // Parse transcript from VTT
    const vttFile = files.find(f => f.endsWith('.vtt'));
    if (!vttFile) {
      console.log(`[yt-dlp] No VTT subtitle file found for ${videoId}`);
      return { metadata, transcript: { found: false, text: '' } };
    }

    const vttContent = await readFile(join(tempDir, vttFile), 'utf-8');
    const text = parseVttToPlainText(vttContent);

    console.log(`[yt-dlp] Transcript: ${text.length} chars clean text`);

    return {
      metadata,
      transcript: { found: text.length > 0, text },
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);

    if (msg.includes('ENOENT')) {
      throw new Error(
        'yt-dlp not found on PATH. Install it: https://github.com/yt-dlp/yt-dlp#installation'
      );
    }
    if (msg.includes('ETIMEDOUT') || msg.includes('killed')) {
      throw new Error(`yt-dlp timed out fetching video ${videoId}`);
    }

    throw new Error(`yt-dlp failed for ${videoId}: ${msg}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Strip VTT markup down to deduplicated plain text.
 *
 * YouTube auto-caption VTT has:
 *  - inline word timestamps  <00:00:05.040>
 *  - <c>...</c> word wrappers
 *  - duplicate lines (prev line repeated, then new text appended)
 *  - [Music] / [Applause] annotations
 */
function parseVttToPlainText(vtt: string): string {
  return vtt
    .split('\n')
    .filter(line => {
      if (line.startsWith('WEBVTT')) return false;
      if (line.startsWith('Kind:')) return false;
      if (line.startsWith('Language:')) return false;
      if (/^\d{2}:\d{2}/.test(line)) return false;
      if (/^\s*$/.test(line)) return false;
      return true;
    })
    .map(line =>
      line
        .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')   // inline timestamps
        .replace(/<\/?c>/g, '')                          // <c> tags
        .replace(/align:start position:\d+%/g, '')       // position metadata
        .replace(/<[^>]+>/g, '')                          // any remaining HTML tags
        .trim()
    )
    .filter(Boolean)
    .filter(line => !/^\[.*\]$/.test(line))              // [Music], [Applause] etc.
    .filter((line, i, arr) => line !== arr[i - 1])        // deduplicate consecutive
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
