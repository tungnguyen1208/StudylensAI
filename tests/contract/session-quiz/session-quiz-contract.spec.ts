import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const extensionRequire = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const Ajv = extensionRequire('ajv').default;
const addFormats = extensionRequire('ajv-formats').default;
const parseYaml = extensionRequire('yaml').parse as (source: string) => OpenApiContract;

// ============================================================
// types
// ============================================================

type ValidateFunction = ((data: unknown) => boolean) & { errors?: unknown };

interface OpenApiContract {
  paths: Record<string, { post?: { responses: Record<string, unknown> } }>;
  components: { schemas: Record<string, unknown> };
}

interface TranscriptCueFixture {
  transcriptCueId: string;
  startMs: number;
  endMs: number;
  text: string;
}

interface TranscriptFixture {
  status: 'available' | 'insufficient' | 'unavailable';
  cues: TranscriptCueFixture[];
}

interface PlaybackSpanFixture {
  startMs: number;
  endMs: number;
}

interface SpanScenarioFixture {
  durationMs: number;
  playbackSpans: PlaybackSpanFixture[];
  expectedCueIds: string[];
}

interface GeneratedOptionFixture {
  optionId: string;
  text: string;
}

interface GeneratedQuestionFixture {
  type: 'multipleChoice' | 'shortAnswer';
  prompt: string;
  options?: GeneratedOptionFixture[];
  correctOptionId?: string;
  referenceAnswer?: string;
  sourceStartMs: number;
  sourceEndMs: number;
}

interface QuestionGenerationResponseFixture {
  questions: GeneratedQuestionFixture[];
}

interface ErrorEnvelopeFixture {
  code: string;
  message: string;
  retryable: boolean;
}

interface SegmentRequestFixture {
  activeStudyMs?: number;
  playbackSpans: PlaybackSpanFixture[];
  [key: string]: unknown;
}

// ============================================================
// validators
// ============================================================

function publicValidator(schemaName: string): { contract: OpenApiContract; validate: ValidateFunction } {
  const contract = parseYaml(readFileSync(`${repoRoot}/contracts/public-api/session-quiz.yaml`, 'utf8'));
  const definitions = JSON.parse(JSON.stringify(contract.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'));
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  return { contract, validate: ajv.compile({ $defs: definitions, $ref: `#/$defs/${schemaName}` }) };
}

function aiValidator(schemaName: string): ValidateFunction {
  const contract = parseYaml(readFileSync(`${repoRoot}/contracts/ai-api/question-generation.yaml`, 'utf8'));
  const definitions = JSON.parse(JSON.stringify(contract.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'));
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  return ajv.compile({ $defs: definitions, $ref: `#/$defs/${schemaName}` });
}

describe('session quiz contract 0.3.0', () => {
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
  it('accepts the capture reference that the Video Activation module really publishes', () => {
    const { validate } = publicValidator('AvailableTranscriptCaptureRef');
    const fromDev1 = {
      transcriptCaptureId: '214edf62-2ab0-4778-815d-19bb460d9703',
      youtubeVideoId: 'dQw4w9WgXcQ',
      language: 'vi',
      source: 'tabAudioStt',
      status: 'available',
      availableCueCount: 3,
      version: 1,
    };
    expect(validate(fromDev1), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...fromDev1, availableCueCount: 0 })).toBe(false);
  });
});

// ============================================================
// segment contract (B05)
// ============================================================

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(`${repoRoot}/contracts/examples/session-quiz/${name}`, 'utf8')) as T;
}

describe('study segment contract 0.3.0', () => {
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
    const { activeStudyMs, ...withoutActiveStudyMs } = loadFixture<SegmentRequestFixture>('create-segment.request.json');
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
    expect(loadFixture<ErrorEnvelopeFixture>('no-transcript.error.json').retryable).toBe(false);
    expect(loadFixture<ErrorEnvelopeFixture>('ai-timeout.error.json').retryable).toBe(true);
  });
});

// ============================================================
// transcript fixtures used for cue selection
// ============================================================

describe('transcript fixtures for segmentation', () => {
  it('keeps cues ordered, non-empty and free of negative ranges', () => {
    for (const name of ['transcript-valid-multi-cue.json', 'transcript-boundary-cues.json']) {
      const snapshot = loadFixture<TranscriptFixture>(name);
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
      const snapshot = loadFixture<TranscriptFixture>(name);
      expect(['insufficient', 'unavailable']).toContain(snapshot.status);
      expect(snapshot.cues).toEqual([]);
    }
  });

  it('describes a seek-and-replay span scenario that matches the multi-cue transcript', () => {
    const spans = loadFixture<SpanScenarioFixture>('playback-spans-seek-replay.json');
    const transcript = loadFixture<TranscriptFixture>('transcript-valid-multi-cue.json');
    const selected = transcript.cues
      .filter((cue) => spans.playbackSpans.some((span) => cue.startMs < span.endMs && cue.endMs > span.startMs))
      .map((cue) => cue.transcriptCueId);
    expect(selected).toEqual(spans.expectedCueIds);
    expect(spans.playbackSpans.every((span) => span.endMs <= spans.durationMs)).toBe(true);
  });
});

// ============================================================
// question generation pipeline (Backend -> FastAPI)
// ============================================================

describe('question generation contract 0.3.0', () => {
  it('validates the deterministic multiple-choice response fixture', () => {
    const validate = aiValidator('QuestionGenerationResponse');
    const fixture = loadFixture<QuestionGenerationResponseFixture>('question-generation-mcq.response.json');
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    const options = fixture.questions[0].options ?? [];
    expect(options.length).toBeGreaterThanOrEqual(3);
    expect(options.map((option) => option.optionId)).toContain(fixture.questions[0].correctOptionId);
  });

  it('validates the deterministic short-answer response fixture', () => {
    const validate = aiValidator('QuestionGenerationResponse');
    const fixture = loadFixture<QuestionGenerationResponseFixture>('question-generation-short-answer.response.json');
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(fixture.questions[0].referenceAnswer).toBeTruthy();
    expect(fixture.questions[0].options).toBeUndefined();
  });

  it('keeps every generated source reference inside the requested segment', () => {
    const request = loadFixture<{ endMs: number }>('question-generation.request.json');
    for (const name of ['question-generation-mcq.response.json', 'question-generation-short-answer.response.json']) {
      for (const question of loadFixture<QuestionGenerationResponseFixture>(name).questions) {
        expect(question.sourceStartMs).toBeGreaterThanOrEqual(0);
        expect(question.sourceEndMs).toBeGreaterThan(question.sourceStartMs);
        expect(question.sourceEndMs).toBeLessThanOrEqual(request.endMs);
      }
    }
  });

  it('rejects an AI response that hides no answer key behind the public envelope shape', () => {
    const publicQuestion = publicValidator('QuestionPublic');
    const generated = loadFixture<QuestionGenerationResponseFixture>('question-generation-mcq.response.json').questions[0];
    expect(publicQuestion.validate(generated)).toBe(false);
  });

  it('validates AI error fixtures against the three-field AI envelope', () => {
    const validate = aiValidator('AiErrorEnvelope');
    const invalidOutput = loadFixture<ErrorEnvelopeFixture>('ai-invalid-output.error.json');
    const timeout = loadFixture<ErrorEnvelopeFixture>('ai-provider-timeout.error.json');
    expect(validate(invalidOutput), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(timeout), JSON.stringify(validate.errors)).toBe(true);
    expect(invalidOutput.retryable).toBe(false);
    expect(timeout.retryable).toBe(true);
    expect(validate({ ...timeout, status: 503 })).toBe(false);
  });

  it('declares the retryable and non-retryable AI responses in the contract', () => {
    const contract = parseYaml(readFileSync(`${repoRoot}/contracts/ai-api/question-generation.yaml`, 'utf8'));
    const responses = contract.paths['/api/ai/question-generation/generate'].post?.responses ?? {};
    expect(Object.keys(responses)).toEqual(expect.arrayContaining(['200', '400', '422', '503']));
  });
});
