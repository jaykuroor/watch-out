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
  stats?: {
    rawChars: number;
    cleanedChars: number;
    reducedChars: number;
    subtitleSource: 'manual' | 'auto' | 'unknown';
  };
}

export interface VideoData {
  metadata: VideoMetadata;
  transcript: TranscriptResult;
}

export async function fetchVideoData(
  videoId: string,
  options?: { timeoutMs?: number }
): Promise<VideoData> {
  const tempDir = join(tmpdir(), 'watchout', videoId);
  const timeoutMs = options?.timeoutMs ?? 30000;
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
    ], { timeout: timeoutMs });

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
    const vttCandidates = files.filter(f => f.endsWith('.vtt'));
    const vttFile = selectBestVttFile(vttCandidates);
    if (!vttFile) {
      console.log(`[yt-dlp] No VTT subtitle file found for ${videoId}`);
      return { metadata, transcript: { found: false, text: '' } };
    }

    const vttContent = await readFile(join(tempDir, vttFile), 'utf-8');
    const parsed = parseVttToPlainText(vttContent);
    const text = parsed.text;
    const subtitleSource: 'manual' | 'auto' | 'unknown' = vttFile.includes('.en.') ? 'manual' : (vttFile.includes('.en-') ? 'auto' : 'unknown');

    console.log(`[yt-dlp] Transcript: ${text.length} chars clean text`);

    return {
      metadata,
      transcript: {
        found: text.length > 0,
        text,
        stats: {
          rawChars: vttContent.length,
          cleanedChars: parsed.cleanedChars,
          reducedChars: parsed.reducedChars,
          subtitleSource,
        },
      },
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
function selectBestVttFile(files: string[]): string | undefined {
  if (files.length === 0) return undefined;
  const manualEnglish = files.find((f) => /\.en\.vtt$/i.test(f));
  if (manualEnglish) return manualEnglish;
  const autoEnglish = files.find((f) => /\.en-[A-Za-z0-9_-]+\.vtt$/i.test(f));
  if (autoEnglish) return autoEnglish;
  return files[0];
}

function parseVttToPlainText(vtt: string): { text: string; cleanedChars: number; reducedChars: number } {
  const cues = vtt
    .split(/\r?\n\r?\n+/)
    .map((block) => cueTextFromBlock(block))
    .filter(Boolean) as string[];

  const cleanedText = cues.join(' ').replace(/\s+/g, ' ').trim();

  const reducedCues: string[] = [];
  let previous = '';
  for (const cue of cues) {
    const noOverlap = removePrefixOverlap(previous, cue);
    if (!noOverlap) continue;
    if (isNearDuplicate(noOverlap, reducedCues)) continue;
    reducedCues.push(noOverlap);
    previous = cue;
  }

  const reducedText = reducedCues.join(' ').replace(/\s+/g, ' ').trim();
  return {
    text: reducedText,
    cleanedChars: cleanedText.length,
    reducedChars: reducedText.length,
  };
}

function cueTextFromBlock(block: string): string {
  const lines = block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('WEBVTT'))
    .filter((line) => !line.startsWith('Kind:'))
    .filter((line) => !line.startsWith('Language:'))
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !/^\d{2}:\d{2}:\d{2}\.\d{3}\s-->\s\d{2}:\d{2}:\d{2}\.\d{3}/.test(line));

  const text = lines
    .map((line) =>
      line
        .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
        .replace(/<\/?c[^>]*>/g, '')
        .replace(/align:start position:\d+%/g, '')
        .replace(/<[^>]+>/g, '')
        .trim()
    )
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text || /^\[.*\]$/.test(text)) return '';
  return text;
}

function removePrefixOverlap(previous: string, current: string): string {
  if (!previous) return current;
  if (current === previous) return '';
  if (current.startsWith(previous)) {
    return current.slice(previous.length).trim();
  }

  const prevWords = previous.toLowerCase().split(/\s+/).filter(Boolean);
  const currWords = current.split(/\s+/).filter(Boolean);
  const maxOverlap = Math.min(14, prevWords.length, currWords.length);

  for (let n = maxOverlap; n >= 3; n -= 1) {
    const prevTail = prevWords.slice(prevWords.length - n).join(' ');
    const currHead = currWords.slice(0, n).join(' ').toLowerCase();
    if (prevTail === currHead) {
      return currWords.slice(n).join(' ').trim();
    }
  }
  return current;
}

function isNearDuplicate(candidate: string, kept: string[]): boolean {
  const normCandidate = normalizeForCompare(candidate);
  if (!normCandidate) return true;
  const window = kept.slice(-8);
  for (const item of window) {
    const normItem = normalizeForCompare(item);
    if (!normItem) continue;
    if (normItem === normCandidate) return true;
    if (jaccardWordSimilarity(normItem, normCandidate) >= 0.92) return true;
  }
  return false;
}

function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function jaccardWordSimilarity(a: string, b: string): number {
  const aSet = new Set(a.split(/\s+/).filter(Boolean));
  const bSet = new Set(b.split(/\s+/).filter(Boolean));
  if (aSet.size === 0 && bSet.size === 0) return 1;
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersection += 1;
  }
  const union = aSet.size + bSet.size - intersection;
  return union > 0 ? intersection / union : 0;
}
