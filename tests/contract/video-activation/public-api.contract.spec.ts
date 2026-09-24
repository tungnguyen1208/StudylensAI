import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const requireExtension = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const Ajv = requireExtension('ajv').default as typeof import('ajv').default;
const addFormats = requireExtension('ajv-formats').default as typeof import('ajv-formats').default;
const yaml = requireExtension('yaml').parse as (value: string) => { components: { schemas: Record<string, unknown> }; paths: Record<string, { post?: { operationId: string }; get?: { operationId: string } }> };
const contract = yaml(readFileSync(`${root}/contracts/public-api/video-activation.yaml`, 'utf8'));

function validate(name: string) {
  const defs = JSON.parse(JSON.stringify(contract.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'));
  const ajv = new Ajv({ strict: false }); addFormats(ajv);
  return ajv.compile({ $defs: defs, $ref: `#/$defs/${name}` });
}

describe('video activation public API contract 0.4.0', () => {
  it('defines JSON caption capture and read endpoints, with no audio upload endpoint', () => {
    expect(contract.paths['/api/video-activation/transcript-captures'].post?.operationId).toBe('createTranscriptCapture');
    expect(contract.paths['/api/video-activation/transcript-captures/{captureId}'].get?.operationId).toBe('getTranscriptCaptureDetails');
    expect(Object.keys(contract.paths).join('\n')).not.toContain('audio-chunks');
  });
  it('validates persisted capture references and cue-only preview data', () => {
    const capture = JSON.parse(readFileSync(`${root}/contracts/examples/video-activation/transcript-capture-created.json`, 'utf8'));
    const details = JSON.parse(readFileSync(`${root}/contracts/examples/video-activation/transcript-capture-details.json`, 'utf8'));
    expect(validate('TranscriptCaptureRef')(capture)).toBe(true);
    expect(validate('TranscriptCaptureDetails')(details)).toBe(true);
    expect(JSON.stringify(details)).not.toContain('audio');
  });
  it.each(['transcript-valid-vi.request.json', 'transcript-valid-en.request.json', 'transcript-unavailable.request.json', 'transcript-insufficient.request.json'])('validates caption request %s', (name) => {
    const item = JSON.parse(readFileSync(`${root}/contracts/examples/video-activation/${name}`, 'utf8'));
    const result = validate('CreateTranscriptCaptureRequest');
    expect(result(item), JSON.stringify(result.errors)).toBe(true);
    expect(item.source).toBe('youtubeCaption');
  });
  it('keeps available caption request identity based on normalized cues', () => {
    const item = JSON.parse(readFileSync(`${root}/contracts/examples/video-activation/transcript-valid-en.request.json`, 'utf8'));
    const canonical = item.cues.map((cue: { startMs: number; endMs: number; text: string }) => `${cue.startMs}|${cue.endMs}|${cue.text}`).join('\n');
    expect(createHash('sha256').update(canonical).digest('hex')).toBe(item.contentHash);
  });
  it('rejects private or audio fields', () => {
    const item = JSON.parse(readFileSync(`${root}/contracts/examples/video-activation/transcript-valid-en.request.json`, 'utf8'));
    const result = validate('CreateTranscriptCaptureRequest'); item.audio = 'never persisted';
    expect(result(item)).toBe(false);
  });
});
