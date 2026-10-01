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

describe('assessment history contract 0.5.0', () => {
  it('validates one atomic full-quiz attempt and one answer shape per question', () => {
    const validate = validator('SubmitQuizAttemptRequest');
    const fixture = JSON.parse(readFileSync(`${root}/contracts/examples/assessment-history/submit-quiz-attempt.request.json`, 'utf8'));
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...fixture, answers: [{ ...fixture.answers[0], answerText: 'also supplied' }] })).toBe(false);
    expect(validate({ ...fixture, answers: [] })).toBe(false);
  });

  it('returns explanations and evidence only after the complete attempt is submitted', () => {
    const validate = validator('QuizAttemptView');
    const attempt = JSON.parse(readFileSync(`${root}/contracts/examples/assessment-history/quiz-attempt.response.json`, 'utf8'));
    expect(validate(attempt), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...attempt, results: [{ ...attempt.results[0], providerPrompt: 'hidden' }] })).toBe(false);
  });

  it('validates persistent history and a retryable safe error envelope', () => {
    const validateHistory = validator('HistoryResponse');
    const history = JSON.parse(readFileSync(`${root}/contracts/examples/assessment-history/fixture-history.response.json`, 'utf8'));
    expect(validateHistory(history), JSON.stringify(validateHistory.errors)).toBe(true);
    const enriched = {
      items: [{ ...history.items[0], videoTitle: 'Networking lesson',
        videoUrl: `https://www.youtube.com/watch?v=${history.items[0].youtubeVideoId}`,
        quizAttemptId: '77777777-7777-4777-8777-777777777777', attemptScore: 0.75 }],
    };
    expect(validateHistory(enriched), JSON.stringify(validateHistory.errors)).toBe(true);
    expect(validateHistory({ items: [{ ...enriched.items[0], correctOptionId: 'private' }] })).toBe(false);

    const validateError = validator('ErrorEnvelope');
    expect(validateError({
      code: 'gradingUnavailable', status: 503, message: 'Answer grading is temporarily unavailable.', traceId: 'trace-123', retryable: true,
    }), JSON.stringify(validateError.errors)).toBe(true);
    expect(validateError({ code: 'idempotencyConflict', status: 409, message: 'Conflict', retryable: false })).toBe(false);
  });
});
