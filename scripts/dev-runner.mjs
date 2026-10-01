import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const aiDir = join(repoRoot, 'services', 'ai');
const extensionDir = join(repoRoot, 'apps', 'extension');
const children = new Map();
let stopping = false;

function withoutSecrets(names) {
  const blocked = new Set(names.map((name) => name.toUpperCase()));
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !blocked.has(name.toUpperCase())),
  );
}

function stopTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child.kill('SIGTERM');
  }
}

function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) stopTree(child);
  process.exit(exitCode);
}

function start(name, command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  children.set(name, child);
  console.log(name + ' started (PID ' + (child.pid ?? 'pending') + ').');
  child.on('error', (error) => {
    console.error(name + ' could not start: ' + error.message);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(name + ' stopped unexpectedly (' + (signal ?? code) + ').');
    stop(code && code !== 0 ? code : 1);
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
if (process.platform === 'win32') process.on('SIGBREAK', () => stop(0));

const backendEnv = withoutSecrets(['GEMINI_API_KEY', 'LLM_API_KEY', 'POSTGRES_PASSWORD']);
const aiEnv = withoutSecrets(['ConnectionStrings__DefaultConnection', 'POSTGRES_PASSWORD']);
const extensionEnv = withoutSecrets([
  'ConnectionStrings__DefaultConnection',
  'GEMINI_API_KEY',
  'LLM_API_KEY',
  'POSTGRES_PASSWORD',
]);

start(
  'Backend',
  'dotnet',
  [
    'watch',
    '--non-interactive',
    'run',
    '--project',
    join(repoRoot, 'services', 'api', 'src', 'StudyLens.Api', 'StudyLens.Api.csproj'),
    '--launch-profile',
    'http',
  ],
  repoRoot,
  backendEnv,
);
start(
  'AI Service',
  join(aiDir, '.venv', 'Scripts', 'python.exe'),
  ['-m', 'uvicorn', 'app.main:app', '--reload', '--host', '127.0.0.1', '--port', '8000'],
  aiDir,
  aiEnv,
);
start(
  'Extension watcher',
  'cmd.exe',
  ['/d', '/s', '/c', 'npm.cmd run dev'],
  extensionDir,
  extensionEnv,
);
