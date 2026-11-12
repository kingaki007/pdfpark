import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const source = dirname(require.resolve('pdfjs-dist/package.json'));
mkdirSync('public/pdf-assets', { recursive: true });
for (const directory of ['cmaps', 'standard_fonts', 'wasm'])
  cpSync(join(source, directory), join('public/pdf-assets', directory), {
    recursive: true,
  });
console.log('PDF rendering assets copied locally.');
const transformerRoot = dirname(
  dirname(require.resolve('@huggingface/transformers')),
);
const transformerRequire = createRequire(join(transformerRoot, 'package.json'));
const onnxEntry = transformerRequire.resolve('onnxruntime-web');
const onnxDist = dirname(onnxEntry);
mkdirSync('public/ai-assets', { recursive: true });
for (const file of [
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
]) {
  cpSync(join(onnxDist, file), join('public/ai-assets', file));
}
