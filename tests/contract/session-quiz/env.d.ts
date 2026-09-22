// Minimal shims for the Node builtins this contract suite uses.
// @types/node is not installed in this workspace and package-lock.json is a HOT file,
// so the types stay local to the Dev 2 contract folder instead of changing shared dependencies.

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

declare module 'node:module' {
  export function createRequire(path: string | URL): (id: string) => any;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
