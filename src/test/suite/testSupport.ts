import * as assert from 'assert';
import * as path from 'path';
import { pathToFileURL } from 'url';
import * as vscode from 'vscode';
import type { ViewerEvent } from '../../webviewContract';

export type RecordedViewerEvent = ViewerEvent & { receivedAt: number };

type UpsertMap<K, V> = Map<K, V> & {
  getOrInsertComputed(key: K, callbackFn: (key: K) => V): V;
};

type UpsertWeakMap<K extends object, V> = WeakMap<K, V> & {
  getOrInsertComputed(key: K, callbackFn: (key: K) => V): V;
};

export async function readExtensionFile(
  extension: vscode.Extension<unknown>,
  ...parts: string[]
): Promise<string> {
  const data = await vscode.workspace.fs.readFile(
    vscode.Uri.joinPath(extension.extensionUri, ...parts),
  );
  // Normalize line endings so source-contract regexes behave identically on
  // Windows checkouts (CRLF) and Linux CI (LF).
  return Buffer.from(data).toString('utf8').replace(/\r\n/g, '\n');
}

export function minimalPdf(label = 'PDF Preview Next'): Uint8Array {
  const safeLabel = label.replace(/[()\\]/g, '');
  const stream = `BT\n/F1 24 Tf\n72 720 Td\n(${safeLabel}) Tj\nET\n`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    [
      '3 0 obj\n',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ',
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\n',
      'endobj\n',
    ].join(''),
    [
      '4 0 obj\n',
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\n`,
      'stream\n',
      stream,
      'endstream\n',
      'endobj\n',
    ].join(''),
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += [
    'trailer\n',
    `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`,
    'startxref\n',
    `${xrefOffset}\n`,
    '%%EOF\n',
  ].join('');

  return Buffer.from(pdf, 'latin1');
}

export async function writePdfFixture(
  extension: vscode.Extension<unknown>,
): Promise<vscode.Uri> {
  // An override reruns the viewer fixture tests against another filesystem,
  // e.g. a WSL UNC path such as \\wsl.localhost\Ubuntu\home\... to reproduce
  // TeX builds that live inside WSL but open in Windows VS Code. The override
  // comes from PDF_TEST_FIXTURE_DIR or, because VS Code does not reliably
  // forward env vars into the test extension host, from a
  // .work/pdf-fixture-dir.txt file at the extension root.
  let overrideDir = process.env.PDF_TEST_FIXTURE_DIR;
  if (!overrideDir) {
    try {
      const overrideFile = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(
          extension.extensionUri,
          '.work',
          'pdf-fixture-dir.txt',
        ),
      );
      overrideDir = Buffer.from(overrideFile).toString('utf8').trim();
    } catch {
      overrideDir = undefined;
    }
  }
  const fixtureDir = overrideDir
    ? vscode.Uri.file(path.join(overrideDir, 'test-fixtures'))
    : vscode.Uri.joinPath(extension.extensionUri, '.work', 'test-fixtures');
  await vscode.workspace.fs.createDirectory(fixtureDir);
  const fixtureUri = vscode.Uri.joinPath(fixtureDir, 'minimal.pdf');
  await vscode.workspace.fs.writeFile(fixtureUri, minimalPdf());
  // Record where the fixture actually went: extension-host console output is
  // not reliably forwarded to the test runner's stdout, and CI debugging of
  // filesystem-override runs (WSL UNC paths) needs ground truth on disk.
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(
      extension.extensionUri,
      '.work',
      'last-fixture-location.txt',
    ),
    Buffer.from(fixtureUri.toString(), 'utf8'),
  );
  return fixtureUri;
}

export async function assertPolyfillsWork(
  extension: vscode.Extension<unknown>,
): Promise<void> {
  await import(
    pathToFileURL(
      vscode.Uri.joinPath(extension.extensionUri, 'lib', 'polyfills.mjs')
        .fsPath,
    ).href
  );

  const map = new Map<string, number>() as UpsertMap<string, number>;
  let mapCalls = 0;
  assert.strictEqual(
    map.getOrInsertComputed('page', () => {
      mapCalls += 1;
      return 1;
    }),
    1,
  );
  assert.strictEqual(
    map.getOrInsertComputed('page', () => {
      mapCalls += 1;
      return 2;
    }),
    1,
  );
  assert.strictEqual(mapCalls, 1);
  assert.strictEqual(map.get('page'), 1);

  const weakMap = new WeakMap<object, string>() as UpsertWeakMap<
    object,
    string
  >;
  const key = {};
  let weakMapCalls = 0;
  assert.strictEqual(
    weakMap.getOrInsertComputed(key, () => {
      weakMapCalls += 1;
      return 'ready';
    }),
    'ready',
  );
  assert.strictEqual(
    weakMap.getOrInsertComputed(key, () => {
      weakMapCalls += 1;
      return 'stale';
    }),
    'ready',
  );
  assert.strictEqual(weakMapCalls, 1);
  assert.strictEqual(weakMap.get(key), 'ready');
  assert.strictEqual(
    Object.prototype.propertyIsEnumerable.call(
      Map.prototype,
      'getOrInsertComputed',
    ),
    false,
  );
  assert.strictEqual(
    Object.prototype.propertyIsEnumerable.call(
      WeakMap.prototype,
      'getOrInsertComputed',
    ),
    false,
  );
  const regexpWithEscape = RegExp as RegExpConstructor & {
    escape(value: string): string;
  };
  const uint8ArrayWithBase64 = Uint8Array as Uint8ArrayConstructor & {
    fromBase64(value: string): Uint8Array;
  };
  assert.strictEqual(regexpWithEscape.escape('a+b?'), '\\x61\\+b\\?');
  assert.deepStrictEqual(
    [...uint8ArrayWithBase64.fromBase64('AQID')],
    [1, 2, 3],
  );
  assert.strictEqual(
    (
      new Uint8Array([1, 2, 3]) as Uint8Array & { toBase64(): string }
    ).toBase64(),
    'AQID',
  );
  assert.strictEqual(
    (new Uint8Array([0, 15, 255]) as Uint8Array & { toHex(): string }).toHex(),
    '000fff',
  );
  const uint8ArrayWithHex = Uint8Array as Uint8ArrayConstructor & {
    fromHex(value: string): Uint8Array;
  };
  assert.deepStrictEqual(
    [...uint8ArrayWithHex.fromHex('000fff')],
    [0, 15, 255],
  );
  if (typeof Response !== 'undefined') {
    const response = new Response(new Uint8Array([1, 2, 3])) as Response & {
      bytes(): Promise<Uint8Array>;
    };
    assert.strictEqual(typeof response.bytes, 'function');
    const bytes = await response.bytes();
    assert.deepStrictEqual([...bytes], [1, 2, 3]);
  }
}
