import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertViewerContract } from './viewer_contract.mjs';

export const forbiddenEntries = [
  /^extension\/\.github\//,
  /^extension\/\.beads\//,
  /^extension\/\.work\//,
  /^extension\/out\//,
  /^extension\/src\/test\/fixtures\//,
  /^extension\/src\//,
  /^extension\/test\//,
  /^extension\/tools\//,
  /^extension\/node_modules\//,
  /(^|\/)\.env(?:$|[./])/i,
  /(^|\/)\.npmrc$/i,
  /\.(?:key|p12|pfx|pem)$/i,
  /(^|\/)(?:plan(?:_[^/]*)?|PLAN|GEMINI|KIMI|AGENTS|CLAUDE|SECURITY)\.md$/i,
  /(^|\/)(?:scratch|tmp|temp)(?:\.|\/)/i,
  /(^|\/)debugger\.(?:js|css)$/i,
  /\.map$/i,
  /\.tsx?$/i,
  /\.vsix$/i,
  /(^|\/)sandbox(?:\.|\/)/i,
  /\.wasm$/i,
];

export const requiredEntries = [
  'extension/dist/extension.js',
  'extension/lib/main.mjs',
  'extension/lib/pdf.css',
  'extension/lib/polyfills.mjs',
  'extension/lib/pdf.worker-wrapper.mjs',
  'extension/lib/pdfjs/build/pdf.min.mjs',
  'extension/lib/pdfjs/build/pdf.worker.min.mjs',
  'extension/lib/pdfjs/web/pdf_viewer.css',
  'extension/lib/pdfjs/web/pdf_viewer.mjs',
];

export function findForbiddenEntries(entries) {
  return entries.filter((entry) =>
    forbiddenEntries.some((pattern) => pattern.test(entry)),
  );
}

export function findMissingRequiredEntries(entries) {
  const entrySet = new Set(entries);
  return requiredEntries.filter((entry) => !entrySet.has(entry));
}

export function expectedPackageMainEntry(packageJsonSource) {
  const packageJson = JSON.parse(packageJsonSource);
  const packageMain = packageJson.main;
  if (typeof packageMain !== 'string' || packageMain.trim() === '') {
    throw new Error('extension/package.json must define a string main entry.');
  }

  const normalized = posix.normalize(packageMain.replace(/\\/g, '/'));
  const relativeMain = normalized.replace(/^\.\//, '');
  if (
    posix.isAbsolute(relativeMain) ||
    relativeMain === '..' ||
    relativeMain.startsWith('../')
  ) {
    throw new Error(`extension/package.json main is not package-relative: ${packageMain}`);
  }

  return `extension/${relativeMain}`;
}

export function findMissingPackageMainEntry(entries, packageJsonSource) {
  const mainEntry = expectedPackageMainEntry(packageJsonSource);
  return entries.includes(mainEntry) ? [] : [mainEntry];
}

function messageFromError(error) {
  return error && typeof error === 'object' && 'message' in error
    ? error.message
    : String(error);
}

function newestVsix() {
  const candidates = readdirSync(process.cwd())
    .filter((name) => name.endsWith('.vsix'))
    .map((name) => {
      const path = join(process.cwd(), name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.path;
}

// unzip is standard on the Linux CI runners; Windows 10+ ships bsdtar as
// tar.exe, which reads zip archives. Both tools receive only local file paths
// and archive entry names, never untrusted arguments.
function hasUnzip() {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const useUnzip = hasUnzip();

function readVsixEntries(vsixPath) {
  const output = useUnzip
    ? execFileSync('unzip', ['-Z1', vsixPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : execFileSync('tar', ['-tf', vsixPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  return output.split(/\r?\n/).filter(Boolean);
}

function readVsixEntry(vsixPath, entry) {
  return useUnzip
    ? execFileSync('unzip', ['-p', vsixPath, entry], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : execFileSync('tar', ['-xOf', vsixPath, entry], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
}

function main() {
  const vsixPath = process.argv[2] ?? newestVsix();
  if (!vsixPath || !existsSync(vsixPath)) {
    console.error('Usage: node ./tools/scan_vsix.mjs <extension.vsix>');
    process.exit(2);
  }

  let entries;
  try {
    entries = readVsixEntries(vsixPath);
  } catch (error) {
    console.error(`Could not inspect ${basename(vsixPath)} with unzip.`);
    if (error.stderr) {
      console.error(String(error.stderr));
    }
    process.exit(2);
  }

  const offenders = findForbiddenEntries(entries);
  if (offenders.length > 0) {
    console.error(`Forbidden files found in ${basename(vsixPath)}:`);
    for (const entry of offenders) {
      console.error(`- ${entry}`);
    }
    process.exit(1);
  }

  const missingEntries = findMissingRequiredEntries(entries);
  if (missingEntries.length > 0) {
    console.error(`Required runtime files missing from ${basename(vsixPath)}:`);
    for (const entry of missingEntries) {
      console.error(`- ${entry}`);
    }
    process.exit(1);
  }

  let packageJsonSource;
  let missingMainEntries;
  try {
    packageJsonSource = readVsixEntry(vsixPath, 'extension/package.json');
    missingMainEntries = findMissingPackageMainEntry(entries, packageJsonSource);
  } catch (error) {
    console.error(`Could not verify extension/package.json main in ${basename(vsixPath)}.`);
    console.error(messageFromError(error));
    process.exit(1);
  }
  if (missingMainEntries.length > 0) {
    console.error(`Packaged extension main is missing from ${basename(vsixPath)}:`);
    for (const entry of missingMainEntries) {
      console.error(`- ${entry}`);
    }
    process.exit(1);
  }

  assertViewerContract({
    webviewSource: readVsixEntry(vsixPath, 'extension/dist/extension.js'),
    stylesSource: readVsixEntry(vsixPath, 'extension/lib/pdf.css'),
    viewerScriptSource: readVsixEntry(vsixPath, 'extension/lib/main.mjs'),
    context: basename(vsixPath),
  });

  console.log(`VSIX content scan passed: ${basename(vsixPath)}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
