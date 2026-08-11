import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  expectedPackageMainEntry,
  findForbiddenEntries,
  findMissingPackageMainEntry,
  findMissingRequiredEntries,
  requiredEntries,
} from './scan_vsix.mjs';

const forbiddenSamples = [
  'extension/.env',
  'extension/.env.local',
  'extension/.npmrc',
  'extension/cert.pem',
  'extension/private.key',
  'extension/cert.p12',
  'extension/cert.pfx',
  'extension/dist/extension.js.map',
  'extension/out/src/test/runTest.js',
  'extension/src/test/fixtures/sample.pdf',
  'extension/src/extension.ts',
  'extension/test/smoke.js',
  'extension/tools/scan_vsix.mjs',
  'extension/plan.md',
  'extension/PLAN.md',
  'extension/scratch/probe.txt',
  'extension/tmp/probe.txt',
  'extension/temp/probe.txt',
];

for (const sample of forbiddenSamples) {
  assert.deepEqual(
    findForbiddenEntries([sample]),
    [sample],
    `expected ${sample} to be forbidden`,
  );
}

const allowedRuntimeEntries = [
  ...requiredEntries,
  'extension/package.json',
  'extension/readme.md',
  'extension/changelog.md',
  'extension/LICENSE.txt',
  'extension/lib/pdfjs/cmaps/90ms-RKSJ-V.bcmap',
  'extension/lib/pdfjs/standard_fonts/LiberationSans-Regular.ttf',
];

assert.deepEqual(findForbiddenEntries(allowedRuntimeEntries), []);
assert.deepEqual(findMissingRequiredEntries(allowedRuntimeEntries), []);
assert.strictEqual(
  expectedPackageMainEntry('{"main":"./dist/extension.js"}'),
  'extension/dist/extension.js',
);
assert.deepEqual(
  findMissingPackageMainEntry(
    allowedRuntimeEntries,
    '{"main":"./dist/extension.js"}',
  ),
  [],
);
assert.deepEqual(
  findMissingPackageMainEntry(
    allowedRuntimeEntries,
    '{"main":"./dist/missing.js"}',
  ),
  ['extension/dist/missing.js'],
);
assert.throws(() => expectedPackageMainEntry('{"main":"../outside.js"}'));

const missingWorker = allowedRuntimeEntries.filter(
  (entry) => entry !== 'extension/lib/pdfjs/build/pdf.worker.min.mjs',
);
assert.deepEqual(findMissingRequiredEntries(missingWorker), [
  'extension/lib/pdfjs/build/pdf.worker.min.mjs',
]);

function writeFile(root, entry, content = '') {
  const path = join(root, entry);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createVsix({ main = './dist/extension.js', extraEntries = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pdf-preview-scan-'));
  try {
    const extensionRoot = join(root, 'extension');
    mkdirSync(extensionRoot, { recursive: true });
    writeFile(
      root,
      'extension/package.json',
      JSON.stringify({ main, name: 'pdf-preview-next', version: '0.0.0' }),
    );
    writeFile(
      root,
      'extension/dist/extension.js',
      `${readFileSync('src/pdfPreview.ts', 'utf8')}\nclass ContractFixture { async openSource() { await this.openExternal(); } }\n`,
    );
    writeFile(
      root,
      'extension/lib/main.mjs',
      readFileSync('lib/main.mjs', 'utf8'),
    );
    writeFile(
      root,
      'extension/lib/pdf.css',
      readFileSync('lib/pdf.css', 'utf8'),
    );
    for (const entry of requiredEntries) {
      if (
        entry === 'extension/dist/extension.js' ||
        entry === 'extension/lib/main.mjs' ||
        entry === 'extension/lib/pdf.css'
      ) {
        continue;
      }
      writeFile(root, entry, 'placeholder');
    }
    for (const [entry, content] of extraEntries) {
      writeFile(root, entry, content);
    }
    const vsix = join(root, 'fixture.vsix');
    // zip is standard on the Linux CI runners; Windows 10+ ships bsdtar as
    // tar.exe, which writes zip archives when told to via --format.
    try {
      execFileSync('zip', ['-qr', vsix, 'extension'], { cwd: root });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      execFileSync('tar', ['-cf', vsix, '--format', 'zip', 'extension'], {
        cwd: root,
      });
    }
    return { root, vsix };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function runScanner(vsix) {
  return execFileSync(
    process.execPath,
    [fileURLToPath(new URL('./scan_vsix.mjs', import.meta.url)), vsix],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function assertScannerFails(vsix, expectedText) {
  assert.throws(
    () => runScanner(vsix),
    (error) => {
      const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      assert.match(output, expectedText);
      return true;
    },
  );
}

{
  const { root, vsix } = createVsix();
  try {
    assert.match(runScanner(vsix), /VSIX content scan passed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const { root, vsix } = createVsix({ main: './dist/missing.js' });
  try {
    assertScannerFails(vsix, /Packaged extension main is missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const { root, vsix } = createVsix({
    extraEntries: [['extension/.env', 'TOKEN=secret']],
  });
  try {
    assertScannerFails(vsix, /Forbidden files found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('scan_vsix matcher and CLI tests passed');
