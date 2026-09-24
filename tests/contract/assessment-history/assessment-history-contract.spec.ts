import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const extensionRequire = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const Ajv = extensionRequire('ajv').default;
const addFormats = extensionRequire('ajv-formats').default;
const parseYaml = extensionRequire('yaml').parse;
const contract = parseYaml(readFileSync(`${root}/contracts/public-api/assessment-history.yaml`, 'utf8'));
const definitions = JSON.parse(JSON.stringify(contract.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'));
const ajv = new Ajv({ strict: false });
addFormats(ajv);

function validator(name) {
  return ajv.compile({ $defs: definitions, $ref: `#/$defs/${name}` });
}

describe('assessment history contract 0.4.0', () => {
  it('validates the answer request and requires one answer shape', () => {
    const validate = validator('SubmitAnswerRequest');
    const fixture = JSON.parse(readFileSync(`${root}/contracts/examples/assessment-history/submit-answer.request.json`, 'utf8'));
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...fixture, selectedOptionId: 'option-a', answerText: 'also supplied' })).toBe(false);
  });

  it('keeps answer keys out of the public grade contract while allowing post-submit reference text', () => {
    const validate = validator('GradeView');
    const grade = {
      answerAttemptId: '33333333-3333-4333-8333-333333333333', questionId: '22222222-2222-4222-8222-222222222222',
      outcome: 'correct', score: 1, referenceAnswer: 'Transcript-backed answer', explanation: 'Matches the source.',
      source: { youtubeVideoId: 'dQw4w9WgXcQ', startMs: 0, endMs: 1000 }, gradedAtUtc: '2026-09-20T00:00:00Z',
    };
    expect(validate(grade), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...grade, correctOptionId: 'option-a' })).toBe(false);
  });

  it('validates persistent history and a retryable safe error envelope', () => {
    const validateHistory = validator('HistoryResponse');
    const history = JSON.parse(readFileSync(`${root}/contracts/examples/assessment-history/fixture-history.response.json`, 'utf8'));
    expect(validateHistory(history), JSON.stringify(validateHistory.errors)).toBe(true);

    const validateError = validator('ErrorEnvelope');
    expect(validateError({
      code: 'gradingUnavailable', status: 503, message: 'Answer grading is temporarily unavailable.', traceId: 'trace-123', retryable: true,
    }), JSON.stringify(validateError.errors)).toBe(true);
    expect(validateError({ code: 'idempotencyConflict', status: 409, message: 'Conflict', retryable: false })).toBe(false);
  });
});
