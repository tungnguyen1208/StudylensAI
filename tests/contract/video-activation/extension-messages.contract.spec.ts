import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const extensionRequire = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const Ajv = extensionRequire('ajv').default as typeof import('ajv').default;
const addFormats = extensionRequire('ajv-formats').default as typeof import('ajv-formats').default;
const schema = JSON.parse(readFileSync(`${repoRoot}/contracts/extension-messages/video-activation.schema.json`, 'utf8'));
const videoContextChangedFixture = JSON.parse(readFileSync(`${repoRoot}/contracts/examples/video-activation/video-context-changed.json`, 'utf8'));
const videoContextUnavailableFixture = JSON.parse(readFileSync(`${repoRoot}/contracts/examples/video-activation/video-context-unavailable.json`, 'utf8'));
const ajv = new Ajv({ strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const envelope = { contractVersion: '0.3.0', correlationId: 'c-1', tabId: 7, youtubeVideoId: 'dQw4w9WgXcQ', occurredAtUtc: '2026-09-20T10:00:00.000Z' };

describe('persistent activation extension message contract 0.3.0', () => {
  it('validates explicit enable and disable envelopes', () => {
    expect(validate({ ...envelope, type: 'ACTIVATION_ENABLED', payload: {
      activationId: 'a-1', source: 'user', videoTitle: 'Networking lesson',
      transcriptCapture: { transcriptCaptureId: 'capture-1', youtubeVideoId: 'dQw4w9WgXcQ', language: 'en', source: 'tabAudioStt', status: 'available', availableCueCount: 1, version: 1 },
      preferences: { quizIntervalMinutes: 10, questionType: 'multipleChoice', difficulty: 'medium' },
    } }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...envelope, type: 'ACTIVATION_DISABLED', payload: { reasonCode: 'userDisabled' } }), JSON.stringify(validate.errors)).toBe(true);
  });
  it('validates normalized player time in integer milliseconds', () => {
    expect(validate({ ...envelope, type: 'PLAYER_PLAYING', payload: { currentTimeMs: 1000, durationMs: 2000 } })).toBe(true);
    expect(validate({ ...envelope, type: 'PLAYER_PLAYING', payload: { currentTimeMs: 1.5 } })).toBe(false);
  });
  it('validates recoverable operation status without exposing implementation details', () => {
    expect(validate({ ...envelope, type: 'OPERATION_STATUS_CHANGED', payload: {
      operation: 'audioTranscription', state: 'failed', code: 'audioChunkUploadFailed',
      message: 'Không thể gửi audio tới Backend.', retryable: true, traceId: 'trace-1',
    } }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...envelope, type: 'OPERATION_STATUS_CHANGED', payload: {
      operation: 'transcriptUpload', state: 'failed', message: 'Lỗi', retryable: 'yes',
    } })).toBe(false);
  });
  it('validates a context transition without exposing transcript or grading data', () => {
    expect(validate(videoContextChangedFixture), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...videoContextChangedFixture, payload: {
      ...videoContextChangedFixture.payload,
      previousYoutubeVideoId: 'not-a-youtube-id',
    } })).toBe(false);
    expect(validate({ ...videoContextChangedFixture, payload: {
      ...videoContextChangedFixture.payload,
      transcriptSnapshot: { contentHash: 'a'.repeat(64) },
    } })).toBe(false);
  });
  it('validates an unsupported page transition that closes only the old flow', () => {
    expect(validate(videoContextUnavailableFixture), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...videoContextUnavailableFixture, payload: {
      ...videoContextUnavailableFixture.payload,
      reasonCode: 'other',
    } })).toBe(false);
  });
  it('rejects an unsupported page-change event', () => {
    expect(validate({ ...envelope, type: 'UNSUPPORTED_PAGE_CHANGE', payload: {} })).toBe(false);
  });
});
