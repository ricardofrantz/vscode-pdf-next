import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const configPath = path.join(scriptDir, 'update_pdfjs.jsonc');

function parseJsonc(source) {
  const stripped = source
    .replace(/\/\/.*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,(\s*[\]}])/g, '$1');
  return JSON.parse(stripped);
}

function repoPath(relativePath) {
  const resolved = path.resolve(repoRoot, relativePath);
  if (!resolved.startsWith(`${repoRoot}${path.sep}`) && resolved !== repoRoot) {
    throw new Error(`Path escapes repository root: ${relativePath}`);
  }
  return resolved;
}

function run(command, args) {
  // On Windows, npm is npm.cmd and Node blocks .cmd execution without a
  // shell. Arguments here are repo-pinned constants from update_pdfjs.jsonc,
  // never untrusted input, so shell resolution is safe.
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32',
  });
}

async function copyEntry(sourceRoot, entry) {
  const source = path.join(sourceRoot, entry.from);
  const destination = repoPath(entry.to);

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rm(destination, { recursive: true, force: true });
  await fs.cp(source, destination, { recursive: true });
}

async function main() {
  const config = parseJsonc(await fs.readFile(configPath, 'utf8'));
  const workDirectory = repoPath(config.workDirectory);
  const sourceDirectory = repoPath(config.sourceDirectory);

  await fs.mkdir(workDirectory, { recursive: true });
  await fs.rm(sourceDirectory, { recursive: true, force: true });

  console.log(`Downloading ${config.packageName}@${config.version}...`);
  const packOutput = run('npm', [
    'pack',
    `${config.packageName}@${config.version}`,
    '--pack-destination',
    config.workDirectory,
    '--json',
  ]);
  const [packInfo] = JSON.parse(packOutput);

  if (packInfo.integrity !== config.integrity) {
    throw new Error(`Integrity mismatch: ${packInfo.integrity} !== ${config.integrity}`);
  }

  const tarball = path.join(workDirectory, packInfo.filename);
  run('tar', ['-xzf', tarball, '-C', workDirectory]);

  await Promise.all(
    config.remove.map((p) => fs.rm(repoPath(p), { recursive: true, force: true })),
  );
  await Promise.all(config.copy.map((entry) => copyEntry(sourceDirectory, entry)));

  const versionContent = [
    `Version: ${config.version}`,
    `Source: ${config.packageName}@${config.version}`,
    `Integrity: ${config.integrity}`,
    `Date: ${new Date().toISOString()}`,
    '',
  ].join('\n');
  await fs.writeFile(repoPath(config.versionFile), versionContent);

  console.log(`Successfully vendored PDF.js ${config.version}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
