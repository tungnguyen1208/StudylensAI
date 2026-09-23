import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const extensionRequire = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const Ajv = extensionRequire('ajv').default;
const addFormats = extensionRequire('ajv-formats').default;
const parseYaml = extensionRequire('yaml').parse;
const contract = parseYaml(readFileSync(`${root}/contracts/ai-api/grading.yaml`, 'utf8'));
const definitions = JSON.parse(JSON.stringify(contract.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'));
const ajv = new Ajv({ strict: false });
addFormats(ajv);

function validator(name: string) {
  return ajv.compile({ $defs: definitions, $ref: `#/$defs/${name}` });
}

describe('grading AI contract 0.3.0', () => {
  it('validates the deterministic short-answer request fixture and contract version', () => {
    const validate = validator('ShortAnswerGradeRequest');
    const fixture = JSON.parse(readFileSync(`${root}/contracts/examples/assessment-history/short-answer-grade.request.json`, 'utf8'));
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...fixture, contractVersion: '0.1.0' })).toBe(false);
    expect(validate({ ...fixture, providerPrompt: 'hidden' })).toBe(false);
    expect(validate({ ...fixture, questionId: 'not-a-uuid' })).toBe(false);
    expect(validate.errors?.some((error) => error.instancePath === '/questionId' && error.keyword === 'format')).toBe(true);
  });

  it('validates a bounded fake-LLM grade and rejects invalid output', () => {
    const validate = validator('ShortAnswerGradeResponse');
    const fixture = JSON.parse(readFileSync(`${root}/contracts/examples/assessment-history/short-answer-grade.response.json`, 'utf8'));
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...fixture, outcome: 'unknown', score: 2 })).toBe(false);
  });
});
