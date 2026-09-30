import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const contract = readFileSync(`${root}/contracts/public-api/video-activation.yaml`, 'utf8');

describe('video activation public API boundary', () => {
  it('exposes no legacy capture endpoint outside the session workflow', () => {
    expect(contract).toContain('version: 0.5.0');
    expect(contract).toContain('paths: {}');
    expect(contract).not.toContain('transcript-captures');
    expect(contract).not.toContain('audio-chunks');
  });
});
