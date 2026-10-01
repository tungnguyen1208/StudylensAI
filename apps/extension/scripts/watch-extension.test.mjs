import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldRebuild } from './watch-extension.mjs';

test('watches source and build scripts including nested content-script files', () => {
  assert.equal(shouldRebuild('src', 'features/video-activation/content-script-entry.ts'), true);
  assert.equal(shouldRebuild('src', 'shell/sidepanel.css'), true);
  assert.equal(shouldRebuild('scripts', 'build-content-script.mjs'), true);
});

test('watches entry files but ignores build output and dependencies', () => {
  assert.equal(shouldRebuild('root', 'manifest.json'), true);
  assert.equal(shouldRebuild('root', 'sidepanel.html'), true);
  assert.equal(shouldRebuild('root', 'dist'), false);
  assert.equal(shouldRebuild('root', 'node_modules'), false);
  assert.equal(shouldRebuild('root', undefined), false);
  assert.equal(shouldRebuild('src', undefined), true);
});
