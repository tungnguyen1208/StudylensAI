import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const bundle = await readFile(resolve('dist/content-script.js'), 'utf8');
if (/\bimport\s*(?:[({*]|[A-Za-z_$])/.test(bundle)) {
  throw new Error('dist/content-script.js must be a self-contained classic script, not an ESM module.');
}
