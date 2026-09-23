import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const extensionRequire = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const Ajv = extensionRequire('ajv').default as typeof import('ajv').default;
const addFormats = extensionRequire('ajv-formats').default as typeof import('ajv-formats').default;
const parseYaml = extensionRequire('yaml').parse as (source: string) => unknown;

interface OpenApiContract {
  components: { schemas: Record<string, unknown> };
  paths: Record<string, {
    post?: { operationId: string; responses: Record<string, unknown> };
    get?: { operationId: string; responses: Record<string, unknown> };
  }>;
}

const contract = parseYaml(
  readFileSync(`${repoRoot}/contracts/public-api/video-activation.yaml`, 'utf8'),
) as OpenApiContract;

function validatorFor(schemaName: string) {
  const definitions = JSON.parse(
    JSON.stringify(contract.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'),
  );
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  return ajv.compile({ $defs: definitions, $ref: `#/$defs/${schemaName}` });
}

describe('video activation public API contract 0.3.0', () => {
  it('defines the idempotent tab-audio capture and append-only chunk endpoints', () => {
    const create = contract.paths['/api/video-activation/transcript-captures'].post!;
    const append = contract.paths['/api/video-activation/transcript-captures/{captureId}/audio-chunks'].post!;
    expect(create.operationId).toBe('createTranscriptCapture');
    expect(append.operationId).toBe('appendTranscriptAudioChunk');
    expect(Object.keys(append.responses)).toEqual(expect.arrayContaining(['200', '400', '404', '409', '502']));
  });

  it('defines a cue-only transcript preview endpoint without raw audio', () => {
    const operation = contract.paths['/api/video-activation/transcript-captures/{captureId}'].get!;
    const fixture = JSON.parse(readFileSync(`${repoRoot}/contracts/examples/video-activation/transcript-capture-details.json`, 'utf8'));
    expect(operation.operationId).toBe('getTranscriptCaptureDetails');
    expect(validatorFor('TranscriptCaptureDetails')(fixture)).toBe(true);
    expect(JSON.stringify(fixture)).not.toContain('audio');
  });

  it('validates capture creation and chunk-progress fixtures without an audio blob', () => {
    const capture = JSON.parse(readFileSync(`${repoRoot}/contracts/examples/video-activation/transcript-capture-created.json`, 'utf8'));
    const progress = JSON.parse(readFileSync(`${repoRoot}/contracts/examples/video-activation/audio-chunk-progress.json`, 'utf8'));
    expect(validatorFor('TranscriptCaptureRef')(capture)).toBe(true);
    expect(validatorFor('TranscriptCaptureProgress')(progress)).toBe(true);
    expect(JSON.stringify(progress)).not.toContain('audio');
  });

  it('defines the idempotent transcript snapshot endpoint', () => {
    const operation = contract.paths['/api/video-activation/transcript-snapshots'].post!;
    expect(operation.operationId).toBe('createTranscriptSnapshot');
    expect(Object.keys(operation.responses)).toEqual(expect.arrayContaining(['200', '400', '409']));
  });

  it.each([
    'transcript-valid-vi.request.json',
    'transcript-valid-en.request.json',
    'transcript-unavailable.request.json',
    'transcript-insufficient.request.json',
    'transcript-idempotency-conflict.request.json',
  ])('validates request fixture %s', (fixtureName) => {
    const validate = validatorFor('CreateTranscriptSnapshotRequest');
    const fixture = JSON.parse(
      readFileSync(`${repoRoot}/contracts/examples/video-activation/${fixtureName}`, 'utf8'),
    );
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
  });

  it('validates the public transcript snapshot reference', () => {
    const validate = validatorFor('TranscriptSnapshotRef');
    const fixture = JSON.parse(
      readFileSync(
        `${repoRoot}/contracts/examples/video-activation/transcript-valid.response.json`,
        'utf8',
      ),
    );
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each(['transcript-valid-vi.request.json', 'transcript-valid-en.request.json'])(
    'keeps contentHash consistent with normalized cues in %s',
    (fixtureName) => {
      const fixture = JSON.parse(
        readFileSync(`${repoRoot}/contracts/examples/video-activation/${fixtureName}`, 'utf8'),
      );
      const canonical = fixture.cues
        .map(
          (cue: { startMs: number; endMs: number; text: string }) =>
            `${cue.startMs}|${cue.endMs}|${cue.text}`,
        )
        .join('\n');
      expect(createHash('sha256').update(canonical).digest('hex')).toBe(fixture.contentHash);
      expect(fixture.idempotencyKey).toBe(
        `transcript:${fixture.youtubeVideoId}:${fixture.contentHash}`,
      );
    },
  );

  it('rejects extra request fields', () => {
    const validate = validatorFor('CreateTranscriptSnapshotRequest');
    const fixture = JSON.parse(
      readFileSync(
        `${repoRoot}/contracts/examples/video-activation/transcript-valid-vi.request.json`,
        'utf8',
      ),
    );
    fixture.secret = 'must-not-pass';
    expect(validate(fixture)).toBe(false);
  });
});
