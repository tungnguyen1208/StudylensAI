import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const extensionRequire = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const Ajv = extensionRequire('ajv').default;
const addFormats = extensionRequire('ajv-formats').default;
const parseYaml = extensionRequire('yaml').parse;

function publicValidator(schemaName) {
  const contract = parseYaml(readFileSync(`${repoRoot}/contracts/public-api/session-quiz.yaml`, 'utf8'));
  const definitions = JSON.parse(JSON.stringify(contract.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'));
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  return { contract, validate: ajv.compile({ $defs: definitions, $ref: `#/$defs/${schemaName}` }) };
}

function aiValidator(schemaName) {
  const contract = parseYaml(readFileSync(`${repoRoot}/contracts/ai-api/question-generation.yaml`, 'utf8'));
  const definitions = JSON.parse(JSON.stringify(contract.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'));
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  return ajv.compile({ $defs: definitions, $ref: `#/$defs/${schemaName}` });
}

describe('session quiz contract 0.1.0', () => {
  it('defines the five public operations required by the vertical module', () => {
    const { contract } = publicValidator('StartStudySessionRequest');
    expect(Object.keys(contract.paths)).toEqual(expect.arrayContaining(['/api/sessions', '/api/sessions/{sessionId}/complete', '/api/sessions/{sessionId}/segments', '/api/quizzes/generate', '/api/quizzes/{quizId}']));
  });
  it('validates the active-session fixture', () => {
    const { validate } = publicValidator('StartStudySessionRequest');
    const fixture = JSON.parse(readFileSync(`${repoRoot}/contracts/examples/session-quiz/start-session-active.request.json`, 'utf8'));
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
  });
  it('validates video-context completion without treating it as learner OFF', () => {
    const { validate } = publicValidator('CompleteStudySessionRequest');
    const fixture = JSON.parse(readFileSync(`${repoRoot}/contracts/examples/session-quiz/complete-session-video-context-changed.request.json`, 'utf8'));
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...fixture, reason: 'unsupportedReason' })).toBe(false);
  });
  it('validates the public generate-quiz fixture with transcript evidence', () => {
    const { validate } = publicValidator('GenerateQuizRequest');
    const fixture = JSON.parse(readFileSync(`${repoRoot}/contracts/examples/session-quiz/generate-quiz.request.json`, 'utf8'));
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
  });
  it('validates public data and rejects an answer key', () => {
    const { validate } = publicValidator('SessionSnapshot');
    const fixture = JSON.parse(readFileSync(`${repoRoot}/contracts/examples/session-quiz/session-active.response.json`, 'utf8'));
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    const { validate: questionValidator } = publicValidator('QuestionPublic');
    expect(questionValidator({ questionId: '66666666-6666-4666-8666-666666666666', type: 'shortAnswer', prompt: 'Question', source: { youtubeVideoId: 'dQw4w9WgXcQ', startMs: 0, endMs: 1 }, correctAnswer: 'secret' })).toBe(false);
  });
  it('validates a quiz-available envelope without answer data', () => {
    const schema = JSON.parse(readFileSync(`${repoRoot}/contracts/extension-messages/session-quiz.schema.json`, 'utf8'));
    const ajv = new Ajv({ strict: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const fixture = JSON.parse(readFileSync(`${repoRoot}/contracts/examples/session-quiz/quiz-available.message.json`, 'utf8'));
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
  });
  it('validates the Backend-to-AI fixture independently from the Extension', () => {
    const validate = aiValidator('QuestionGenerationRequest');
    const fixture = JSON.parse(readFileSync(`${repoRoot}/contracts/examples/session-quiz/question-generation.request.json`, 'utf8'));
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
  });
  it('accepts the snapshot revision that the Video Activation module really publishes', () => {
    const { validate } = publicValidator('TranscriptSnapshotRef');
    const fromDev1 = {
      transcriptSnapshotId: '214edf62-2ab0-4778-815d-19bb460d9703',
      youtubeVideoId: 'dQw4w9WgXcQ',
      language: 'vi',
      status: 'available',
      contentHash: '966f1fa50f66266efde7b670ed2c823836cf0d08a87b2b9ce1ccb74690d22ad8',
      version: '1',
    };
    expect(validate(fromDev1), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...fromDev1, version: '' })).toBe(false);
  });
});

// ============================================================
// segment contract (B05)
// ============================================================

function loadFixture(name) {
  return JSON.parse(readFileSync(`${repoRoot}/contracts/examples/session-quiz/${name}`, 'utf8'));
}

describe('study segment contract 0.1.0', () => {
  it('validates the create-segment request fixture with replayed spans', () => {
    const { validate } = publicValidator('CreateStudySegmentRequest');
    expect(validate(loadFixture('create-segment.request.json')), JSON.stringify(validate.errors)).toBe(true);
  });

  it('validates the create-segment response fixture', () => {
    const { validate } = publicValidator('StudySegmentRef');
    expect(validate(loadFixture('create-segment.response.json')), JSON.stringify(validate.errors)).toBe(true);
  });

  it('keeps activeStudyMs optional and rejects unknown or empty segment payloads', () => {
    const { validate } = publicValidator('CreateStudySegmentRequest');
    const { activeStudyMs, ...withoutActiveStudyMs } = loadFixture('create-segment.request.json');
    expect(activeStudyMs).toBe(600000);
    expect(validate(withoutActiveStudyMs), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...withoutActiveStudyMs, playbackSpans: [] })).toBe(false);
    expect(validate({ ...withoutActiveStudyMs, transcriptCues: [] })).toBe(false);
    expect(validate({ ...withoutActiveStudyMs, activeStudyMs: -1 })).toBe(false);
  });

  it('validates every segment and generation error fixture as an error envelope', () => {
    const { validate } = publicValidator('ErrorEnvelope');
    for (const name of ['no-transcript.error.json', 'ai-timeout.error.json', 'invalid-ai-output.error.json']) {
      expect(validate(loadFixture(name)), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
    expect(loadFixture('no-transcript.error.json').retryable).toBe(false);
    expect(loadFixture('ai-timeout.error.json').retryable).toBe(true);
  });
});

// ============================================================
// transcript fixtures used for cue selection
// ============================================================

describe('transcript fixtures for segmentation', () => {
  it('keeps cues ordered, non-empty and free of negative ranges', () => {
    for (const name of ['transcript-valid-multi-cue.json', 'transcript-boundary-cues.json']) {
      const snapshot = loadFixture(name);
      expect(snapshot.status).toBe('available');
      expect(snapshot.cues.length).toBeGreaterThan(0);
      const sorted = [...snapshot.cues].sort((left, right) => left.startMs - right.startMs);
      expect(snapshot.cues.map((cue) => cue.transcriptCueId)).toEqual(sorted.map((cue) => cue.transcriptCueId));
      for (const cue of snapshot.cues) {
        expect(cue.endMs).toBeGreaterThan(cue.startMs);
        expect(cue.startMs).toBeGreaterThanOrEqual(0);
        expect(cue.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('exposes no cue when the snapshot is not available', () => {
    for (const name of ['transcript-insufficient.json', 'transcript-unavailable.json']) {
      const snapshot = loadFixture(name);
      expect(['insufficient', 'unavailable']).toContain(snapshot.status);
      expect(snapshot.cues).toEqual([]);
    }
  });

  it('describes a seek-and-replay span scenario that matches the multi-cue transcript', () => {
    const spans = loadFixture('playback-spans-seek-replay.json');
    const transcript = loadFixture('transcript-valid-multi-cue.json');
    const selected = transcript.cues
      .filter((cue) => spans.playbackSpans.some((span) => cue.startMs < span.endMs && cue.endMs > span.startMs))
      .map((cue) => cue.transcriptCueId);
    expect(selected).toEqual(spans.expectedCueIds);
    expect(spans.playbackSpans.every((span) => span.endMs <= spans.durationMs)).toBe(true);
  });
});

