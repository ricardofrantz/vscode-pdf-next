import * as esbuild from 'esbuild';

const args = new Set(process.argv.slice(2));
const production = args.has('--production');
const watch = args.has('--watch');

const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  sourcemap: production ? false : 'external',
  sourcesContent: false,
  // Keep the host bundle readable: the release scanner (tools/scan_vsix.mjs)
  // verifies behavioral source patterns inside the packaged VSIX, which
  // minification would defeat. The bundle is ~43KB in a multi-MB package.
  minify: false,
  logLevel: 'info',
};

if (watch) {
  const context = await esbuild.context(buildOptions);
  await context.watch();
  console.log('Watching extension bundle...');
} else {
  await esbuild.build(buildOptions);
}
