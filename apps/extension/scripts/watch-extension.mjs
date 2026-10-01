import { spawn, spawnSync } from 'node:child_process';
import { watch } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootFiles = new Set([
  'manifest.json',
  'sidepanel.html',
  'vite.config.ts',
  'tsconfig.json',
  'package.json',
]);

export function shouldRebuild(scope, filename) {
  // Windows can emit an unnamed root-directory event when dist changes.
  // Rebuilding for that event would create a build loop.
  if (!filename) return scope !== 'root';
  if (scope === 'root') return rootFiles.has(String(filename).replaceAll('\\', '/'));
  return scope === 'src' || scope === 'scripts';
}

async function main() {
  let buildRunning = false;
  let buildRequested = true;
  let activeBuild = null;
  let debounceTimer = null;
  let closing = false;
  const watchers = [];

  function close() {
    if (closing) return;
    closing = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    for (const watcher of watchers) watcher.close();
    if (activeBuild?.pid && activeBuild.exitCode === null) {
      if (process.platform === 'win32') {
        spawnSync('taskkill.exe', ['/PID', String(activeBuild.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } else {
        activeBuild.kill('SIGTERM');
      }
    }
    process.exit(0);
  }

  async function buildOnce() {
    console.log('[Extension] Building content script, service worker, and side panel...');
    return new Promise((resolveBuild) => {
      const windows = process.platform === 'win32';
      activeBuild = spawn(
        windows ? 'cmd.exe' : 'npm',
        windows ? ['/d', '/s', '/c', 'npm.cmd run build'] : ['run', 'build'],
        { cwd: extensionDir, stdio: 'inherit', windowsHide: true },
      );
      activeBuild.once('error', (error) => {
        console.error('[Extension] Build could not start: ' + error.message);
        resolveBuild(1);
      });
      activeBuild.once('exit', (code) => resolveBuild(code ?? 1));
    });
  }

  async function runPendingBuild() {
    if (closing || buildRunning || !buildRequested) return;
    buildRequested = false;
    buildRunning = true;
    const exitCode = await buildOnce();
    activeBuild = null;
    buildRunning = false;
    if (exitCode === 0) {
      console.log('[Extension] dist is ready. Reload the unpacked extension; refresh YouTube after content-script changes.');
    } else {
      console.error('[Extension] Build failed. Fix the error and save a source file to retry.');
    }
    if (buildRequested) scheduleBuild();
  }

  function scheduleBuild() {
    buildRequested = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runPendingBuild();
    }, 300);
  }

  function watchPath(scope, path, recursive) {
    const watcher = watch(path, { recursive }, (_event, filename) => {
      if (shouldRebuild(scope, filename)) scheduleBuild();
    });
    watcher.on('error', (error) => {
      console.error('[Extension] File watcher failed: ' + error.message);
      close();
    });
    watchers.push(watcher);
  }

  watchPath('src', join(extensionDir, 'src'), true);
  watchPath('scripts', join(extensionDir, 'scripts'), true);
  watchPath('root', extensionDir, false);
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  if (process.platform === 'win32') process.on('SIGBREAK', close);
  await runPendingBuild();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
