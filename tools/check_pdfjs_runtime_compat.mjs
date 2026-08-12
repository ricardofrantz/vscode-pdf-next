import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { assertViewerContract } from './viewer_contract.mjs';

// The advertised PDF.js version is a selling point; keep package.json and
// README claims pinned to the actually vendored runtime.
const vendoredVersion = (await readFile('lib/PDFJS_VERSION', 'utf8')).match(
  /Version:\s*([\d.]+)/,
)?.[1];
assert.ok(vendoredVersion, 'lib/PDFJS_VERSION must record the vendored version.');
const packageDescription = JSON.parse(
  await readFile('package.json', 'utf8'),
).description;
assert.ok(
  packageDescription.includes(vendoredVersion),
  `package.json description must mention the vendored PDF.js version ${vendoredVersion}; update it after running update:pdfjs.`,
);
const readmeSource = await readFile('README.md', 'utf8');
assert.ok(
  readmeSource.includes(`pdfjs-dist@${vendoredVersion}`),
  `README.md must mention pdfjs-dist@${vendoredVersion}; update it after running update:pdfjs.`,
);

const mainSource = await readFile('lib/main.mjs', 'utf8');
const polyfillsSource = await readFile('lib/polyfills.mjs', 'utf8');
const coreSource = await readFile('lib/pdfjs/build/pdf.min.mjs', 'utf8');
const viewerSource = await readFile('lib/pdfjs/web/pdf_viewer.mjs', 'utf8');
const workerSource = await readFile('lib/pdfjs/build/pdf.worker.min.mjs', 'utf8');
const workerWrapperSource = await readFile('lib/pdf.worker-wrapper.mjs', 'utf8');
const webviewSource = await readFile('out/src/pdfPreview.js', 'utf8');
const stylesSource = await readFile('lib/pdf.css', 'utf8');

const polyfillsImportIndex = mainSource.indexOf("import './polyfills.mjs';");
const pdfCoreImportIndex = mainSource.indexOf(
  "import * as pdfjsLib from './pdfjs/build/pdf.min.mjs';",
);
const viewerImportIndex = mainSource.indexOf(
  "await import('./pdfjs/web/pdf_viewer.mjs')",
);

assert.ok(
  polyfillsImportIndex >= 0,
  'lib/main.mjs must import lib/polyfills.mjs.',
);
assert.ok(pdfCoreImportIndex >= 0, 'lib/main.mjs must import PDF.js core.');
assert.ok(viewerImportIndex >= 0, 'lib/main.mjs must import PDF.js viewer.');
assert.ok(
  polyfillsImportIndex < pdfCoreImportIndex,
  'lib/polyfills.mjs must evaluate before PDF.js core.',
);
assert.ok(
  pdfCoreImportIndex < viewerImportIndex,
  'PDF.js core must be exposed before PDF.js viewer.',
);
assert.ok(
  polyfillsImportIndex < viewerImportIndex,
  'lib/polyfills.mjs must evaluate before PDF.js viewer.',
);
assert.ok(
  !mainSource.includes("from './pdfjs/build/pdf.worker.min.mjs'"),
  'lib/main.mjs must not statically import the PDF.js worker bundle; it costs ~1.2MB of main-thread parse and forces fake-worker mode.',
);
assert.doesNotMatch(
  mainSource,
  /globalThis\.pdfjsWorker\s*=/,
  'lib/main.mjs must never set globalThis.pdfjsWorker: PDF.js then skips real Worker creation and parses PDFs on the UI thread.',
);
assert.match(
  mainSource,
  /globalThis\.pdfjsLib = pdfjsLib/,
  'lib/main.mjs must expose PDF.js core globally because pdf_viewer.mjs resolves it through globalThis.pdfjsLib.',
);
assert.match(
  viewerSource,
  /globalThis\.pdfjsLib/,
  'pdf_viewer.mjs is expected to resolve PDF.js core through globalThis.pdfjsLib; if this changes, revisit the main.mjs global.',
);
assert.match(
  mainSource,
  /workerType:[\s\S]*?instanceof Worker[\s\S]*?\? 'worker'[\s\S]*?: 'fake'/,
  'viewer-ready must report whether a real worker spawned so tests can catch fake-worker regressions.',
);

if (viewerSource.includes('getOrInsertComputed')) {
  assert.match(
    polyfillsSource,
    /Map\.prototype\.getOrInsertComputed/,
    'PDF.js uses Map.prototype.getOrInsertComputed, so lib/polyfills.mjs must patch Map.',
  );
  assert.match(
    polyfillsSource,
    /WeakMap\.prototype\.getOrInsertComputed/,
    'PDF.js uses WeakMap.prototype.getOrInsertComputed, so lib/polyfills.mjs must patch WeakMap.',
  );
}
if (viewerSource.includes('RegExp.escape')) {
  assert.match(
    polyfillsSource,
    /RegExp\.escape/,
    'PDF.js uses RegExp.escape, so lib/polyfills.mjs must patch RegExp.',
  );
}
assert.match(
  workerWrapperSource,
  /import ['"]\.\/polyfills\.mjs['"];/,
  'PDF.js worker wrapper must import polyfills before the worker bundle.',
);

// lib/main.mjs applyPageColors() re-renders theme changes in place instead of
// reloading the document. It relies on these PDF.js viewer internals; if an
// upgrade drops them, the viewer falls back to a full reload at runtime, but
// this check should force a deliberate decision instead of silent slowdown.
assert.match(
  viewerSource,
  /refresh\(noUpdate = false/,
  'PDFViewer.refresh() is required for in-place theme re-render (applyPageColors in lib/main.mjs).',
);
assert.match(
  viewerSource,
  /for \(const pageView of this\._pages\)/,
  'PDFViewer._pages iteration contract changed; update applyPageColors in lib/main.mjs.',
);
assert.match(
  viewerSource,
  /pageColors: this\.pageColors/,
  'PDFPageView must read pageColors at render time for in-place theme re-render.',
);
assert.match(
  webviewSource,
  /pdf\.worker-wrapper\.mjs/,
  'Webview configuration must point workerSrc at the polyfilled worker wrapper.',
);

// PDF.js 6 removed eval-based font/PostScript compilation along with the
// isEvalSupported option. Pin the actual security property: no dynamic code
// evaluation may exist in any vendored runtime bundle. (`new Function` must be
// followed by `(` so identifiers like `new FunctionBasedShading(` don't
// false-positive.)
for (const [label, source] of [
  ['lib/pdfjs/build/pdf.min.mjs', coreSource],
  ['lib/pdfjs/build/pdf.worker.min.mjs', workerSource],
  ['lib/pdfjs/web/pdf_viewer.mjs', viewerSource],
]) {
  assert.doesNotMatch(
    source,
    /\bnew Function\s*\(/,
    `${label} must not construct code with new Function().`,
  );
  assert.doesNotMatch(
    source,
    /[^.\w]eval\s*\(/,
    `${label} must not call eval().`,
  );
}

// Include the core bundle: Baseline APIs used only there (e.g. toBase64)
// still need polyfills on the oldest supported VS Code Electron runtime.
const runtimeSources = `${coreSource}\n${viewerSource}\n${workerSource}`;
if (runtimeSources.includes('.bytes()')) {
  assert.match(
    polyfillsSource,
    /Response\.prototype\.bytes/,
    'PDF.js uses Response.prototype.bytes, so lib/polyfills.mjs must patch Response.',
  );
}
if (runtimeSources.includes('fromBase64')) {
  assert.match(
    polyfillsSource,
    /Uint8Array\.fromBase64/,
    'PDF.js uses Uint8Array.fromBase64, so lib/polyfills.mjs must patch Uint8Array.',
  );
}
if (runtimeSources.includes('toBase64')) {
  assert.match(
    polyfillsSource,
    /Uint8Array\.prototype\.toBase64/,
    'PDF.js uses Uint8Array.prototype.toBase64, so lib/polyfills.mjs must patch Uint8Array.',
  );
}
if (runtimeSources.includes('toHex')) {
  assert.match(
    polyfillsSource,
    /Uint8Array\.prototype\.toHex/,
    'PDF.js uses Uint8Array.prototype.toHex, so lib/polyfills.mjs must patch Uint8Array.',
  );
}
if (runtimeSources.includes('fromHex')) {
  assert.match(
    polyfillsSource,
    /Uint8Array\.fromHex/,
    'PDF.js uses Uint8Array.fromHex, so lib/polyfills.mjs must patch Uint8Array.',
  );
}

await import(pathToFileURL('lib/polyfills.mjs').href);

const map = new Map();
let mapCalls = 0;
assert.equal(
  map.getOrInsertComputed('page', () => {
    mapCalls += 1;
    return 1;
  }),
  1,
);
assert.equal(
  map.getOrInsertComputed('page', () => {
    mapCalls += 1;
    return 2;
  }),
  1,
);
assert.equal(mapCalls, 1);
assert.equal(map.get('page'), 1);

const weakMap = new WeakMap();
const key = {};
let weakMapCalls = 0;
assert.equal(
  weakMap.getOrInsertComputed(key, () => {
    weakMapCalls += 1;
    return 'ready';
  }),
  'ready',
);
assert.equal(
  weakMap.getOrInsertComputed(key, () => {
    weakMapCalls += 1;
    return 'stale';
  }),
  'ready',
);
assert.equal(weakMapCalls, 1);
assert.equal(weakMap.get(key), 'ready');

assert.equal(
  Object.prototype.propertyIsEnumerable.call(
    Map.prototype,
    'getOrInsertComputed',
  ),
  false,
);
assert.equal(
  Object.prototype.propertyIsEnumerable.call(
    WeakMap.prototype,
    'getOrInsertComputed',
  ),
  false,
);
assert.equal(RegExp.escape('a+b?'), '\\x61\\+b\\?');
assert.equal(RegExp.escape(' space'), '\\x20space');
assert.equal(RegExp.escape('foo-bar'), '\\x66oo\\x2dbar');
assert.equal(
  Object.prototype.propertyIsEnumerable.call(RegExp, 'escape'),
  false,
);
assert.equal(typeof Uint8Array.fromBase64, 'function');
assert.deepEqual([...Uint8Array.fromBase64('AQID')], [1, 2, 3]);
assert.equal(new Uint8Array([1, 2, 3]).toBase64(), 'AQID');
assert.equal(new Uint8Array([0, 15, 255]).toHex(), '000fff');
assert.deepEqual([...Uint8Array.fromHex('000fff')], [0, 15, 255]);
if (typeof Response !== 'undefined') {
  assert.equal(typeof Response.prototype.bytes, 'function');
  const bytes = await new Response(new Uint8Array([1, 2, 3])).bytes();
  assert.deepEqual([...bytes], [1, 2, 3]);
}

// Local edits to the vendored runtime, applied by tools/update_pdfjs.mjs from
// the "patch" list in update_pdfjs.jsonc. The update script fails loudly if a
// pattern stops matching, but nothing stops someone restoring lib/pdfjs by
// hand — so the shipped bytes are checked here too.
assert.match(
  viewerSource,
  /const DEFAULT_CACHE_SIZE = 3;/,
  'lib/pdfjs/web/pdf_viewer.mjs must keep 3 rendered pages, not the upstream 10; ' +
    'rendered canvases dominate resident memory. Run bun run update:pdfjs to reapply.',
);

assertViewerContract({
  webviewSource,
  stylesSource,
  viewerScriptSource: mainSource,
  context: 'compiled webview',
});
