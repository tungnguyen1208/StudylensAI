export interface RawTranscriptCue {
  startMs: number;
  endMs?: number;
  text: string;
}

export interface TranscriptCue {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptSourcePort {
  getLanguage(): string;
  readRawCues(): RawTranscriptCue[];
}

export interface YouTubeCaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: 'asr' | string;
  label: string;
}

export type TranscriptReadResult =
  | { status: 'available'; language: string; cues: TranscriptCue[] }
  | { status: 'unavailable'; language: string; cues: [] }
  | { status: 'insufficient'; language: string; cues: [] };

const MINIMUM_TRANSCRIPT_CHARACTERS = 100;
const DEFAULT_LAST_CUE_DURATION_MS = 5_000;

export function readTranscript(source: TranscriptSourcePort): TranscriptReadResult {
  const language = normalizeLanguage(source.getLanguage());
  const rawCues = source.readRawCues();
  if (rawCues.length === 0) return { status: 'unavailable', language, cues: [] };

  const cues = normalizeTranscriptCues(rawCues);
  const contentLength = cues.reduce((total, cue) => total + cue.text.length, 0);
  if (cues.length === 0 || contentLength < MINIMUM_TRANSCRIPT_CHARACTERS) {
    return { status: 'insufficient', language, cues: [] };
  }
  return { status: 'available', language, cues };
}

export function normalizeTranscriptCues(rawCues: RawTranscriptCue[]): TranscriptCue[] {
  const candidates = rawCues
    .map((cue) => ({
      startMs: Number.isFinite(cue.startMs) ? Math.round(cue.startMs) : -1,
      endMs: cue.endMs !== undefined && Number.isFinite(cue.endMs) ? Math.round(cue.endMs) : undefined,
      text: normalizeCueText(cue.text),
    }))
    .filter((cue) => cue.startMs >= 0 && cue.text.length > 0)
    .sort((left, right) => left.startMs - right.startMs);

  const normalized: TranscriptCue[] = [];
  candidates.forEach((cue, index) => {
    if (cue.endMs !== undefined && cue.endMs <= cue.startMs) return;
    const nextStartMs = candidates[index + 1]?.startMs;
    const endMs = cue.endMs ?? (nextStartMs !== undefined && nextStartMs > cue.startMs
      ? nextStartMs
      : cue.startMs + DEFAULT_LAST_CUE_DURATION_MS);
    if (!normalized.some((item) => item.startMs === cue.startMs && item.endMs === endMs && item.text === cue.text)) {
      normalized.push({ startMs: cue.startMs, endMs, text: cue.text });
    }
  });
  return normalized;
}

/** Reads caption metadata that YouTube already rendered into the watch page. */
export function extractCaptionTracksFromDom(
  root: ParentNode = document,
  expectedYoutubeVideoId?: string,
): YouTubeCaptionTrack[] {
  const tracks: YouTubeCaptionTrack[] = [];

  // This metadata is often available before YouTube has materialized the
  // script text or the Transcript panel. It is optional because isolated
  // worlds do not expose it consistently across Chrome/Edge releases.
  const pageWindow = pageWindowFor(root);
  const pageTracks = (pageWindow as (Window & {
    ytInitialPlayerResponse?: { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: unknown[] } } };
  }) | null)?.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (Array.isArray(pageTracks)) {
    for (const track of pageTracks) addCaptionTrack(tracks, track, expectedYoutubeVideoId);
  }

  for (const script of Array.from(root.querySelectorAll('script'))) {
    const list = findCaptionTracks(script.textContent ?? '');
    for (const item of list) addCaptionTrack(tracks, item, expectedYoutubeVideoId);
  }
  return deduplicateTracks(tracks);
}

export function selectBestCaptionTrack(
  tracks: readonly YouTubeCaptionTrack[],
  preferredLanguage = document.documentElement.lang,
): YouTubeCaptionTrack | null {
  if (tracks.length === 0) return null;
  const preferred = normalizeLanguage(preferredLanguage).split('-')[0];
  return [...tracks].sort((left, right) =>
    languageRank(left.languageCode, preferred) - languageRank(right.languageCode, preferred) ||
    asrRank(left) - asrRank(right) ||
    left.label.localeCompare(right.label),
  )[0] ?? null;
}

/** Fetches the public caption URL from the learner's browser context. */
export async function fetchTimedtextCues(
  trackUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<RawTranscriptCue[]> {
  const jsonUrl = timedtextUrl(trackUrl, 'json3');
  try {
    const response = await fetcher(jsonUrl, { credentials: 'include' });
    if (response.ok) {
      const cues = parseJson3Transcript(await response.text());
      if (cues.length > 0) return cues;
    }
  } catch {
    // DOM fallback is responsible for user-visible recovery.
  }
  try {
    const response = await fetcher(timedtextUrl(trackUrl, 'xml'), { credentials: 'include' });
    return response.ok ? parseXmlTranscript(await response.text()) : [];
  } catch {
    return [];
  }
}

export function parseJson3Transcript(jsonText: string): RawTranscriptCue[] {
  let value: unknown;
  try { value = JSON.parse(jsonText); } catch { return []; }
  if (!isRecord(value) || !Array.isArray(value.events)) return [];
  return value.events.flatMap((event) => {
    if (!isRecord(event) || !Array.isArray(event.segs)) return [];
    const startMs = numberField(event.tStartMs, event.tStart, 1_000);
    if (startMs === null) return [];
    const duration = numberField(event.dDurationMs, event.dDuration, 1_000);
    const text = event.segs.map((segment) => isRecord(segment) && typeof segment.utf8 === 'string' ? segment.utf8 : '').join('');
    return [{ startMs, ...(duration !== null && duration > 0 ? { endMs: startMs + duration } : {}), text }];
  });
}

export function parseXmlTranscript(xmlText: string): RawTranscriptCue[] {
  if (typeof DOMParser === 'undefined') return Array.from(xmlText.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)).flatMap((match) => {
    const start = /\bstart=["']([^"']+)["']/.exec(match[1])?.[1];
    const duration = /\bdur=["']([^"']+)["']/.exec(match[1])?.[1];
    const startSeconds = Number(start);
    const durationSeconds = Number(duration);
    if (!Number.isFinite(startSeconds) || startSeconds < 0) return [];
    const startMs = Math.round(startSeconds * 1_000);
    return [{ startMs, ...(Number.isFinite(durationSeconds) && durationSeconds > 0 ? { endMs: startMs + Math.round(durationSeconds * 1_000) } : {}), text: decodeXmlEntities(match[2].replace(/<[^>]*>/g, '')) }];
  });
  const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (xml.querySelector('parsererror')) return [];
  return Array.from(xml.querySelectorAll('text')).flatMap((element) => {
    const startSeconds = Number(element.getAttribute('start'));
    const durationSeconds = Number(element.getAttribute('dur'));
    if (!Number.isFinite(startSeconds) || startSeconds < 0) return [];
    const startMs = Math.round(startSeconds * 1_000);
    return [{
      startMs,
      ...(Number.isFinite(durationSeconds) && durationSeconds > 0 ? { endMs: startMs + Math.round(durationSeconds * 1_000) } : {}),
      text: element.textContent ?? '',
    }];
  });
}

export function createDomTranscriptSource(root: ParentNode = document): TranscriptSourcePort {
  return {
    getLanguage: () => document.documentElement.lang || 'und',
    readRawCues: () => Array.from(root.querySelectorAll<HTMLElement>([
      // Legacy transcript panel.
      'ytd-transcript-segment-renderer',
      // Current YouTube panel renders transcript rows as buttons rather than
      // segment-renderer elements in some Chrome/YouTube rollouts.
      'ytd-transcript-search-panel-renderer button',
      // Keep data-backed rows working if YouTube changes the container again.
      '[data-start-time-ms]',
    ].join(',')))
      .map(readDomCue)
      .filter((cue): cue is RawTranscriptCue => cue !== null),
  };
}

export function parseTimestampText(value: string): number | null {
  const normalized = value.trim();
  const parts = normalized.split(':').map(Number);
  if ((parts.length === 2 || parts.length === 3) && parts.every((item) => Number.isFinite(item))) {
    const seconds = parts.reduce((total, part) => total * 60 + part, 0);
    return seconds >= 0 ? Math.round(seconds * 1_000) : null;
  }

  // The current Vietnamese YouTube transcript UI exposes a row label such as
  // "1 phút, 9 giây" or "30 giây" instead of an mm:ss timestamp.
  const minuteMatch = /^(\d+)\s*(?:phút|minute(?:s)?)(?:,?\s*(\d+)\s*(?:giây|second(?:s)?))?$/iu.exec(normalized);
  if (minuteMatch) return (Number(minuteMatch[1]) * 60 + Number(minuteMatch[2] ?? 0)) * 1_000;
  const secondMatch = /^(\d+)\s*(?:giây|second(?:s)?)$/iu.exec(normalized);
  return secondMatch ? Number(secondMatch[1]) * 1_000 : null;
}

function findCaptionTracks(source: string): unknown[] {
  const key = source.indexOf('"captionTracks"');
  if (key < 0) return [];
  const arrayStart = source.indexOf('[', key);
  if (arrayStart < 0) return [];
  const arrayEnd = balancedArrayEnd(source, arrayStart);
  if (arrayEnd < 0) return [];
  try {
    const value: unknown = JSON.parse(source.slice(arrayStart, arrayEnd + 1));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function balancedArrayEnd(source: string, start: number): number {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '[') depth += 1;
    else if (character === ']' && --depth === 0) return index;
  }
  return -1;
}

function timedtextUrl(value: string, format: 'json3' | 'xml'): string {
  const url = new URL(value);
  url.searchParams.set('fmt', format);
  return url.toString();
}

function isTimedtextUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && (url.hostname === 'www.youtube.com' || url.hostname.endsWith('.youtube.com'));
  } catch {
    return false;
  }
}

function addCaptionTrack(
  destination: YouTubeCaptionTrack[],
  value: unknown,
  expectedYoutubeVideoId?: string,
): void {
  if (!isRecord(value) || typeof value.baseUrl !== 'string' || !isTimedtextUrl(value.baseUrl)) return;
  if (expectedYoutubeVideoId && !captionTrackMatchesVideo(value.baseUrl, expectedYoutubeVideoId)) return;
  const languageCode = typeof value.languageCode === 'string' ? normalizeLanguage(value.languageCode) : 'und';
  const name = isRecord(value.name) && typeof value.name.simpleText === 'string' ? value.name.simpleText : languageCode;
  destination.push({
    baseUrl: value.baseUrl,
    languageCode,
    ...(typeof value.kind === 'string' ? { kind: value.kind } : {}),
    label: name,
  });
}

function pageWindowFor(root: ParentNode): Window | null {
  if (typeof Document !== 'undefined' && root instanceof Document) return root.defaultView;
  const candidate = root as ParentNode & { defaultView?: Window | null; ownerDocument?: Document | null };
  return candidate.defaultView ?? candidate.ownerDocument?.defaultView ??
    (typeof window !== 'undefined' ? window : null);
}

function captionTrackMatchesVideo(baseUrl: string, youtubeVideoId: string): boolean {
  try {
    return new URL(baseUrl).searchParams.get('v') === youtubeVideoId;
  } catch {
    return false;
  }
}

function languageRank(language: string, preferred: string): number {
  const base = language.split('-')[0];
  if (base === 'vi') return 0;
  if (base === preferred) return 1;
  if (base === 'en') return 2;
  return 3;
}

function asrRank(track: YouTubeCaptionTrack): number {
  return track.kind === 'asr' ? 1 : 0;
}

function deduplicateTracks(tracks: YouTubeCaptionTrack[]): YouTubeCaptionTrack[] {
  return tracks.filter((track, index) => tracks.findIndex((item) => item.baseUrl === track.baseUrl) === index);
}

function readDomCue(element: HTMLElement): RawTranscriptCue | null {
  const timestampElement = element.querySelector<HTMLElement>('.segment-timestamp');
  const textElement = element.querySelector<HTMLElement>('.segment-text');
  const leadingTimestamp = parseLeadingTimestamp(element.textContent ?? '');
  const startFromAttribute = Number(element.dataset.startTimeMs);
  const startMs = Number.isFinite(startFromAttribute)
    ? Math.round(startFromAttribute)
    : parseTimestampText(timestampElement?.textContent ?? '') ?? leadingTimestamp?.startMs ?? null;
  const text = textElement?.textContent ?? leadingTimestamp?.text;
  if (startMs === null || !text) return null;
  const endFromAttribute = Number(element.dataset.endTimeMs);
  return { startMs, ...(Number.isFinite(endFromAttribute) && endFromAttribute > 0 ? { endMs: Math.round(endFromAttribute) } : {}), text };
}

function parseLeadingTimestamp(value: string): { startMs: number; text: string } | null {
  const match = /^(\d{1,2}:\d{2}(?::\d{2})?|\d+\s*(?:phút|minute(?:s)?)(?:,?\s*\d+\s*(?:giây|second(?:s)?))?|\d+\s*(?:giây|second(?:s)?))\s+(.+)$/iu.exec(value.trim());
  if (!match) return null;
  const startMs = parseTimestampText(match[1]);
  const text = match[2]?.trim();
  return startMs === null || !text ? null : { startMs, text };
}

function numberField(milliseconds: unknown, seconds: unknown, factor: number): number | null {
  if (typeof milliseconds === 'number' && Number.isFinite(milliseconds)) return Math.round(milliseconds);
  if (typeof seconds === 'number' && Number.isFinite(seconds)) return Math.round(seconds * factor);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCueText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity] ?? entity);
}

function normalizeLanguage(value: string): string {
  return value.trim().toLowerCase() || 'und';
}
