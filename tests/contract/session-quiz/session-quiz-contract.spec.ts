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
});
