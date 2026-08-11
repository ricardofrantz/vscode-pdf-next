import * as path from 'path';

import { mkdirSync, readFileSync, writeFileSync } from 'fs';

import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');

    // The path to the extension test script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './suite/index');
    // When the fixture override points at a UNC path (e.g. a WSL share),
    // allow its host in the spawned VS Code: clean test profiles block UNC
    // hosts by default (security.allowedUNCHosts).
    let fixtureDir = process.env.PDF_TEST_FIXTURE_DIR;
    if (!fixtureDir) {
      try {
        fixtureDir = readFileSync(
          path.resolve(
            extensionDevelopmentPath,
            '.work',
            'pdf-fixture-dir.txt',
          ),
          'utf8',
        ).trim();
      } catch {
        fixtureDir = undefined;
      }
    }
    const uncHost = fixtureDir?.match(/^\\\\([^\\]+)\\/)?.[1];
    if (uncHost) {
      // The extension host enforces security.allowedUNCHosts from user
      // settings, so write the allowance into the test profile.
      const settingsPath = path.resolve(
        extensionDevelopmentPath,
        '.vscode-test',
        'user-data',
        'User',
        'settings.json',
      );
      mkdirSync(path.dirname(settingsPath), { recursive: true });
      let settings: Record<string, unknown> = {};
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<
          string,
          unknown
        >;
      } catch {
        settings = {};
      }
      const allowedHosts = new Set([
        ...((settings['security.allowedUNCHosts'] as string[] | undefined) ??
          []),
        uncHost,
      ]);
      settings['security.allowedUNCHosts'] = [...allowedHosts];
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }

    const vscodeVersion = process.env.VSCODE_TEST_VERSION ?? '1.95.0';
    // Pass the Electron executable itself, never the CLI wrapper
    // (resolveCliPathFromVSCodeExecutablePath): on Windows the .cmd wrapper
    // spawns VS Code detached and exits 0 immediately, which makes the test
    // run report success without executing a single test.
    const vscodeExecutablePath = await downloadAndUnzipVSCode(vscodeVersion);

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      vscodeExecutablePath,
      // VS Code does not reliably forward custom env vars into the test
      // extension host; pass the fixture override through explicitly.
      ...(process.env.PDF_TEST_FIXTURE_DIR
        ? {
            extensionTestsEnv: {
              PDF_TEST_FIXTURE_DIR: process.env.PDF_TEST_FIXTURE_DIR,
            },
          }
        : {}),
    });
  } catch (err) {
    console.error('Failed to run tests', err);
    process.exit(1);
  }
}

main();
