import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const source = dirname(require.resolve('pdfjs-dist/package.json'));
mkdirSync('public/pdf-assets', { recursive: true });
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) cpSync(join(source, directory), join('public/pdf-assets', directory), { recursive: true });
console.log('PDF rendering assets copied locally.');
