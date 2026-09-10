import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const extensionRequire = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const Ajv = extensionRequire('ajv').default as typeof import('ajv').default;
const addFormats = extensionRequire('ajv-formats').default as typeof import('ajv-formats').default;
const schema = JSON.parse(
  readFileSync(`${repoRoot}/contracts/extension-messages/video-activation.schema.json`, 'utf8'),
);
const ajv = new Ajv({ strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

describe('video activation extension message contract 0.1.0', () => {
  it.each([
    'video-valid.json',
    'player-playing.json',
    'player-buffering.json',
    'player-seeked.json',
  ])('validates fixture %s', (fixtureName) => {
    const fixture = JSON.parse(
      readFileSync(`${repoRoot}/contracts/examples/video-activation/${fixtureName}`, 'utf8'),
    );
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects messages without tab and video context', () => {
    const fixture = JSON.parse(
      readFileSync(`${repoRoot}/contracts/examples/video-activation/video-valid.json`, 'utf8'),
    );
    delete fixture.tabId;
    delete fixture.youtubeVideoId;
    expect(validate(fixture)).toBe(false);
  });

  it('rejects extra fields and invalid timestamp units', () => {
    const fixture = JSON.parse(
      readFileSync(`${repoRoot}/contracts/examples/video-activation/player-playing.json`, 'utf8'),
    );
    fixture.payload.currentTimeMs = 1.5;
    fixture.secret = 'must-not-pass';
    expect(validate(fixture)).toBe(false);
  });
});
