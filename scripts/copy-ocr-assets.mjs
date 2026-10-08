// Build step (npm "prebuild"): copy the OCR engine's files into public/ocr so the app serves them
// itself (BNK-14, Peter 10 Oct 2026): no third-party script runs on a page showing client data.
// Pinned by package.json (exact versions): tesseract.js 5.1.1, tesseract.js-core 5.1.1,
// @tesseract.js-data/eng 1.0.0 (4.0.0_best_int, the language data tesseract.js 5 uses by default).
// public/ocr is generated, not committed (.gitignore).
import { mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const out = new URL('public/ocr/', root);
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
];
for (const [from, to] of files) {
  const src = new URL(from, root), dst = new URL(to, out);
  if (!existsSync(src)) { console.error(`[copy-ocr-assets] missing ${from} (run npm install)`); process.exit(1); }
  mkdirSync(new URL('.', dst), { recursive: true });
  copyFileSync(src, dst);
  const sha = createHash('sha256').update(readFileSync(dst)).digest('hex').slice(0, 12);
  console.log(`[copy-ocr-assets] ${to} ${Math.round(statSync(dst).size / 1024)} KB sha256 ${sha}…`);
}
