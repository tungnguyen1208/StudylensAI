import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const contract = readFileSync(`${root}/contracts/public-api/video-activation.yaml`, 'utf8');
const accountContract = readFileSync(`${root}/contracts/public-api/account-access.yaml`, 'utf8');

describe('video activation public API boundary', () => {
  it('exposes no legacy capture endpoint outside the session workflow', () => {
    expect(contract).toContain('version: 0.7.0');
    expect(contract).toContain('paths: {}');
    expect(contract).not.toContain('transcript-captures');
    expect(contract).not.toContain('audio-chunks');
  });

  it('publishes authenticated account and quota endpoints without changing the AI contract', () => {
    expect(accountContract).toContain('version: 0.7.0');
    expect(accountContract).toContain('/api/auth/register:');
    expect(accountContract).toContain('/api/auth/login:');
    expect(accountContract).toContain('/api/account/password:');
    expect(accountContract).toContain('/api/account/quota:');
    expect(accountContract).toContain('StudyLensBearer');
    expect(accountContract).not.toContain('/api/auth/google/');
    expect(accountContract).not.toContain('Gemini');
  });
});
