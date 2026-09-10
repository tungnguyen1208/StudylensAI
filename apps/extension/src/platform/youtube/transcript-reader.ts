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

export type TranscriptReadResult =
  | { status: 'available'; language: string; cues: TranscriptCue[] }
  | { status: 'unavailable'; language: string; cues: [] }
  | { status: 'insufficient'; language: string; cues: [] };

const MINIMUM_TRANSCRIPT_CHARACTERS = 100;
const DEFAULT_LAST_CUE_DURATION_MS = 5000;

export function readTranscript(source: TranscriptSourcePort): TranscriptReadResult {
  const language = normalizeLanguage(source.getLanguage());
  const rawCues = source.readRawCues();
  if (rawCues.length === 0) {
    return { status: 'unavailable', language, cues: [] };
  }

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
      endMs:
        cue.endMs !== undefined && Number.isFinite(cue.endMs) ? Math.round(cue.endMs) : undefined,
      text: normalizeCueText(cue.text),
    }))
    .filter((cue) => cue.startMs >= 0 && cue.text.length > 0)
    .sort((left, right) => left.startMs - right.startMs);

  const normalized: TranscriptCue[] = [];
  candidates.forEach((cue, index) => {
    if (cue.endMs !== undefined && cue.endMs <= cue.startMs) {
      return;
    }

    const nextStartMs = candidates[index + 1]?.startMs;
    const inferredEndMs =
      nextStartMs !== undefined && nextStartMs > cue.startMs
        ? nextStartMs
        : cue.startMs + DEFAULT_LAST_CUE_DURATION_MS;
    const endMs = cue.endMs ?? inferredEndMs;

    const duplicate = normalized.some(
      (existing) =>
        existing.startMs === cue.startMs && existing.endMs === endMs && existing.text === cue.text,
    );
    if (!duplicate) {
      normalized.push({ startMs: cue.startMs, endMs, text: cue.text });
    }
  });

  return normalized;
}

export function createDomTranscriptSource(root: ParentNode = document): TranscriptSourcePort {
  return {
    getLanguage: () => document.documentElement.lang || 'und',
    readRawCues: () =>
      Array.from(root.querySelectorAll<HTMLElement>('ytd-transcript-segment-renderer'))
        .map(readDomCue)
        .filter((cue): cue is RawTranscriptCue => cue !== null),
  };
}

export function parseTimestampText(value: string): number | null {
  const parts = value
    .trim()
    .split(':')
    .map((part) => Number(part));
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds >= 0 ? Math.round(seconds * 1000) : null;
}

function readDomCue(element: HTMLElement): RawTranscriptCue | null {
  const timestampElement = element.querySelector<HTMLElement>('.segment-timestamp');
  const textElement = element.querySelector<HTMLElement>('.segment-text');
  const startFromAttribute = Number(element.dataset.startTimeMs);
  const startMs = Number.isFinite(startFromAttribute)
    ? Math.round(startFromAttribute)
    : parseTimestampText(timestampElement?.textContent ?? '');

  if (startMs === null || !textElement) {
    return null;
  }

  const endFromAttribute = Number(element.dataset.endTimeMs);
  return {
    startMs,
    endMs: Number.isFinite(endFromAttribute) && endFromAttribute > 0 ? Math.round(endFromAttribute) : undefined,
    text: textElement.textContent ?? '',
  };
}

function normalizeCueText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeLanguage(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized || 'und';
}
