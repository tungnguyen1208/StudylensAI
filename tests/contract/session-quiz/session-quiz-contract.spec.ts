import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const extensionRequire = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const Ajv = extensionRequire('ajv').default;
const addFormats = extensionRequire('ajv-formats').default;
const parseYaml = extensionRequire('yaml').parse;

type ValidateFunction = ((data: unknown) => boolean) & { errors?: unknown };

function validator(contractPath: string, schemaName: string): { contract: any; validate: ValidateFunction } {
  const contract = parseYaml(readFileSync(`${repoRoot}/${contractPath}`, 'utf8'));
  const definitions = JSON.parse(JSON.stringify(contract.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'));
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  return { contract, validate: ajv.compile({ $defs: definitions, $ref: `#/$defs/${schemaName}` }) };
}

function publicValidator(schemaName: string) {
  return validator('contracts/public-api/session-quiz.yaml', schemaName);
}

function aiValidator(schemaName: string) {
  return validator('contracts/ai-api/question-generation.yaml', schemaName);
}

function fixture(name: string): any {
  return JSON.parse(readFileSync(`${repoRoot}/contracts/examples/session-quiz/${name}`, 'utf8'));
}

describe('full-video learning package contract 0.5.0', () => {
  it('exposes immediate session, full transcript, polling, retry and completion only', () => {
    const { contract } = publicValidator('StartStudySessionRequest');
    expect(Object.keys(contract.paths)).toEqual([
      '/api/sessions',
      '/api/sessions/{sessionId}/transcript',
      '/api/sessions/{sessionId}/learning-package',
      '/api/sessions/{sessionId}/retry',
      '/api/sessions/{sessionId}/complete',
    ]);
    expect(JSON.stringify(contract.paths)).not.toContain('segments');
  });

  it('validates an immediate session without an interval or transcript prerequisite', () => {
    const request = fixture('start-session-active.request.json');
    const response = fixture('session-active.response.json');
    const start = publicValidator('StartStudySessionRequest').validate;
    const snapshot = publicValidator('SessionSnapshot').validate;
    expect(start(request), JSON.stringify(start.errors)).toBe(true);
    expect(snapshot(response), JSON.stringify(snapshot.errors)).toBe(true);
    expect(start({ ...request, preferences: { ...request.preferences, quizIntervalMinutes: 5 } })).toBe(false);
  });

  it.each([
    'transcript-valid-multi-cue.json',
    'transcript-unavailable.json',
    'transcript-insufficient.json',
  ])('validates full transcript submission %s', (name) => {
    const validate = publicValidator('SubmitTranscriptRequest').validate;
    expect(validate(fixture(name)), JSON.stringify(validate.errors)).toBe(true);
  });

  it('validates persisted learning package and retry state', () => {
    const packageValidator = publicValidator('LearningPackage').validate;
    const retryValidator = publicValidator('RetryProcessingRequest').validate;
    expect(packageValidator(fixture('learning-package-ready.response.json')), JSON.stringify(packageValidator.errors)).toBe(true);
    expect(retryValidator(fixture('retry-quiz.request.json')), JSON.stringify(retryValidator.errors)).toBe(true);
    expect(retryValidator({ contractVersion: '0.5.0', operation: 'segmentCreate' })).toBe(false);
  });

  it('validates idempotent session completion reasons', () => {
    const validate = publicValidator('CompleteStudySessionRequest').validate;
    const request = fixture('complete-session-video-context-changed.request.json');
    expect(validate(request), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...request, reason: 'unsupportedReason' })).toBe(false);
  });

  it('keeps answer keys out of public quiz data', () => {
    const validate = publicValidator('QuestionPublic').validate;
    const question = fixture('learning-package-ready.response.json').quiz.questions[0];
    expect(validate(question), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...question, correctOptionId: 'option-a' })).toBe(false);
  });

  it('validates the full-video quiz message envelope', () => {
    const schema = JSON.parse(readFileSync(`${repoRoot}/contracts/extension-messages/session-quiz.schema.json`, 'utf8'));
    const ajv = new Ajv({ strict: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(fixture('quiz-available.message.json')), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe('Backend-to-AI full-video contract 0.5.0', () => {
  it('validates transcript generation from a public YouTube video ID', () => {
    const request = aiValidator('TranscriptGenerationRequest').validate;
    const response = aiValidator('TranscriptGenerationResponse').validate;
    expect(request(fixture('transcript-generation.request.json')), JSON.stringify(request.errors)).toBe(true);
    expect(response(fixture('transcript-generation.response.json')), JSON.stringify(response.errors)).toBe(true);
  });

  it('validates full-transcript question generation and private answer data', () => {
    const request = aiValidator('QuestionGenerationRequest').validate;
    const response = aiValidator('QuestionGenerationResponse').validate;
    const exampleRequest = fixture('question-generation.request.json');
    expect(request(exampleRequest), JSON.stringify(request.errors)).toBe(true);
    expect(exampleRequest.endMs).toBe(900_000);
    expect(exampleRequest.questionCount).toBe(5);
    for (const name of ['question-generation-mcq.response.json', 'question-generation-short-answer.response.json']) {
      const exampleResponse = fixture(name);
      expect(response(exampleResponse), `${name}: ${JSON.stringify(response.errors)}`).toBe(true);
      expect(exampleResponse.questions.length).toBeLessThan(exampleRequest.questionCount);
    }
  });

  it('keeps every generated evidence range inside the requested full video', () => {
    const request = fixture('question-generation.request.json');
    for (const name of ['question-generation-mcq.response.json', 'question-generation-short-answer.response.json']) {
      for (const question of fixture(name).questions) {
        expect(question.sourceStartMs).toBeGreaterThanOrEqual(request.startMs);
        expect(question.sourceEndMs).toBeGreaterThan(question.sourceStartMs);
        expect(question.sourceEndMs).toBeLessThanOrEqual(request.endMs);
      }
    }
  });

  it('keeps blocked provider content non-retryable and secret-safe', () => {
    const validate = aiValidator('AiErrorEnvelope').validate;
    const blocked = fixture('ai-provider-blocked.error.json');
    expect(validate(blocked), JSON.stringify(validate.errors)).toBe(true);
    expect(blocked.code).toBe('providerBlockedContent');
    expect(blocked.retryable).toBe(false);
    expect(blocked.message).not.toMatch(/key|token|prompt/i);
  });

  it('reports provider quota failures as retryable without exposing secrets', () => {
    const validate = aiValidator('AiErrorEnvelope').validate;
    const limited = fixture('ai-provider-rate-limited.error.json');
    expect(validate(limited), JSON.stringify(validate.errors)).toBe(true);
    expect(limited.code).toBe('providerRateLimited');
    expect(limited.retryable).toBe(true);
    expect(limited.message).not.toMatch(/key|token|prompt/i);
  });
});
