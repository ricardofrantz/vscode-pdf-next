# Changelog

## 2.2.1 (2026/08/11)

- Make Reader mode visually distinct: pages render with a warm e-reader
  sepia palette (`#f4ecd8` paper, `#5b4636` text) instead of duplicating
  Night's dark rendering, and find highlights use the light-paper colors on
  sepia pages. The theme cycle now offers four genuinely different looks:
  Clear, Night, Reader, and Invert.

## 2.2.0 (2026/08/11)

- Load PDF bytes through the extension host instead of a webview resource
  fetch. The webview's service-worker resource path stalls for many seconds
  (or indefinitely) on UNC-backed files such as `\\wsl.localhost\...` WSL
  shares, which made PDFs from WSL workspaces appear only after a long hang.
  The host reads the file with the workspace filesystem API — which handles
  UNC shares and remote workspaces correctly — and transfers the bytes to the
  viewer as a binary message. The webview now loads resources only from the
  extension itself, tightening the sandbox. The integration suite can replay
  its viewer tests against a WSL UNC path (`.work/pdf-fixture-dir.txt`
  override).
- Keep live reload working on WSL/UNC files: VS Code's file watchers cannot
  watch `\\wsl.localhost\...` shares, so previews of UNC-backed PDFs also
  poll file metadata every 2 seconds as a fallback, including
  delete/recreate cycles from TeX-style builds.

- Upgrade the bundled PDF.js runtime from 5.6.205 to 6.2.108. PDF.js 6
  removed its eval-based font/PostScript code paths entirely; the release
  compat check now verifies that no `eval`/`new Function` exists anywhere in
  the vendored runtime instead of relying on the removed `isEvalSupported`
  flag.
- Restore the complete CJK character-map set. Previous packages shipped an
  incomplete cmap subset (17 of 169 files, missing common horizontal-writing
  variants), which could break text extraction and rendering in some Chinese,
  Japanese, and Korean PDFs.
- Make the release tooling run on Windows: the PDF.js updater resolves npm
  through the shell, and the VSIX scanner and its self-tests fall back to
  bsdtar when zip/unzip are unavailable.
- Repair and expand CI: the workflow still used `npm ci` after the bun
  migration (no `package-lock.json` exists, so every run failed) and now
  installs with bun, and verification runs on a matrix of Linux, Windows, and
  macOS against both VS Code 1.95.0 (the `engines` floor) and the latest
  stable release.
- Run PDF parsing and rendering in a real PDF.js worker thread. The viewer no
  longer imports the ~1.2 MB worker bundle on the webview main thread, which
  previously forced PDF.js into "fake worker" mode and did all PDF compute on
  the UI thread. Because VS Code webviews serve extension resources through a
  service worker that dedicated workers cannot reach, PDF.js's own worker
  bootstrap stalls in webviews (a multi-second hang before silently falling
  back to the UI thread); the viewer now builds the worker in the page
  context from a self-contained blob (polyfills + worker bundle, no imports)
  and hands PDF.js the running worker. On any failure the previous fallback
  path remains. The `viewer-ready` event reports the active worker mode plus
  fetch/total load timings, an integration test asserts real-worker mode, and
  load results are logged to the "vscode-pdf Next" output channel.
- Polyfill `Uint8Array.prototype.toHex`/`Uint8Array.fromHex`: PDF.js 6 uses
  `toHex` in the worker, which VS Code 1.95's Electron does not ship, so PDFs
  failed to load entirely on the oldest supported VS Code. The runtime compat
  check now also covers the hex helpers and scans the core bundle for
  Baseline API usage.
- Fix the VS Code integration test harness: it previously launched the CLI
  wrapper instead of the Electron executable, which on Windows detaches and
  reports success without running any test. Also make the suite pass on real
  Windows runs (platform-correct path expectations, CRLF-tolerant source
  contracts, extension-host console quirks) and refresh source contracts that
  had drifted from the code (theme cycle, copy shortcut, print dispatch,
  auto-reload persistence, zero-page guard).
- Switch appearance modes (Clear/Night/Reader/Invert) by re-rendering pages in
  place instead of refetching and reparsing the whole document.
- Update the active thumbnail highlight in constant time instead of scanning
  every thumbnail on each page change.
- Build release bundles with the production esbuild profile (no source maps)
  and align the esbuild target with the VS Code 1.95 runtime (Node 20). The
  host bundle stays unminified on purpose: the release scanner verifies
  behavioral source patterns inside the packaged VSIX.
- Drop the manually declared `activationEvents`; VS Code 1.74+ generates them
  from the `contributes` section.

## 2.1.0 (2026/06/13)

- Add a separate Auto Reload toolbar toggle and `pdf-preview.reload.automatic`
  setting while keeping manual reload available through the toolbar command,
  command palette action, and `Cmd/Ctrl+R`.
- Add reliable PDF text copy through the host clipboard bridge, plus opt-in
  `pdf-preview.copy.autoCopySelection` support for copying selected PDF text on
  mouse release.
- Live-update open previews when Auto Reload or auto-copy settings change, and
  keep multiple previews synchronized with settings changes.
- Harden host-to-viewer webview message handling by validating trusted message
  sources and known message types before dispatch.

## 2.0.2 (2026/05/12)

- Fix toolbar clipping in side-by-side and Working Tree diff PDF previews by
  compacting toolbar labels before split-pane widths cause controls to collide.
- Keep toolbar buttons from shrinking their labels into the button borders, and
  lock the responsive toolbar contract in both source and packaged-webview
  checks.

## 2.0.1 (2026/05/12)

- Migrate the package manager from npm to bun; replace `package-lock.json` with
  `bun.lock`, update all build/test/lint scripts, and update the release workflow
  to install and verify with bun.
- Close the 2026-04-30 security-audit hardening pass: add a semver regex guard
  on the `release_tag` workflow input so malformed tags fail before any shell
  expansion, and document the trusted-workspace `printCommand` boundary in
  SECURITY.md.
- Change the default Print action to open the PDF in the system viewer for
  reliable native print dialogs instead of silently queueing `lp`.
- Add `vscode-pdf Next: Print Directly to Default Printer` for advanced direct
  printing through `pdf-preview.printCommand` or CUPS `lp`, with captured
  diagnostics and explicit fallback messages.
- Add a maintenance guide for dependency, PDF.js, VS Code, packaging, security,
  and release upkeep.

## 2.0.0 (2026/04/29)

- Promote the fork to a public release after the PDF.js 5 viewer hardening,
  package hygiene, thumbnail navigation, print/link handling, focus-preserving
  reloads, and bundled release automation work completed across the 1.x line.
- Keep the 1.10.0 bundled extension-host runtime and guarded release workflow;
  this release is a metadata/publication milestone rather than a viewer runtime
  rewrite.

## 1.10.0 (2026/04/29)

- Bundle the extension host entrypoint with esbuild and load the extension from
  `dist/extension.js` instead of compiled `out/src` files.
- Keep `vscode` external to the bundle, run the bundle step during
  `vscode:prepublish`, and build the bundled entrypoint before VS Code tests.
- Tighten VSIX hygiene so packages ship the bundled host output and `lib/`
  runtime assets only; the scanner now rejects maps, source/test files, plans,
  scratch/temp files, and missing PDF.js runtime files.
- Record the pre-bundling baseline for comparison:
  `pdf-preview-next-1.9.0.vsix` packaged 138 entries and was 1,529,171 bytes
  (1.46 MiB). The bundled `pdf-preview-next-1.10.0.vsix` packages 133 entries
  and remains about 1.46 MiB.
- Harden release automation with SHA-pinned GitHub Actions, workflow
  concurrency groups, and a `marketplace-publish` environment gate before VS
  Code Marketplace or Open VSX publishing can use configured secrets.

## 1.9.0 (2026/04/29)

- Add a thumbnails sidebar panel backed by bounded, IntersectionObserver-driven
  canvas rendering so large PDFs do not allocate thumbnails for every page at
  once.
- Add `pdf-preview.default.sidebarPanel` with `outline` and `thumbnails` values;
  `pdf-preview.default.sidebar` still controls whether the sidebar opens by
  default.
- Persist the active sidebar panel with per-PDF view state while preserving
  compatibility with older saved view states that only stored outline visibility.
- Add thumbnail click navigation, active-page tracking, and keyboard navigation:
  Up/Down move through thumbnails and Enter jumps to the focused page.

## 1.8.0 (2026/04/29)

- Keep file-watcher reloads from refocusing the viewer while preserving
  user-initiated refresh focus behavior.
- Add integration coverage for the file-watcher reload focus path.

## 1.7.0 (2026/04/29)

- Add host-side system printing for the toolbar and command path, with an
  optional no-shell `pdf-preview.printCommand` override.
- Add local inter-PDF link handling for relative `.pdf` links, preserving
  fragments such as `#page=2` without relaxing the webview CSP.
- Make `vscode-pdf Next: Reset View State` reset the active webview
  immediately instead of waiting for the next open.

## 1.6.0 (2026/04/28)

- Add checked-in regression fixtures for outline, password-protected, and
  intentionally broken PDFs.
- Mark PDF defaults and appearance settings as resource-scoped and read them
  with the opened PDF as the VS Code configuration scope.
- Add `vscode-pdf Next: Reset View State`, clearing only the active PDF's
  saved page, zoom, scroll, and outline-sidebar state.
- Add contributed-surface tests for command IDs, setting defaults, resource
  scopes, webview resource roots, and nonce-bound CSP behavior.
- Harden VSIX packaging hygiene so source files, plans, scratch directories,
  and test fixtures stay out of release packages.

## 1.5.0 (2026/04/28)

- Add `night` to `pdf-preview.appearance.theme`, using PDF.js page recoloring
  for lower-eye-strain reading in dark VS Code setups.
- Add `reader` to `pdf-preview.appearance.theme` as the future smart
  color-preserving reader mode; it currently uses the safe night rendering path.
- Add a toolbar page-mode cycle for switching the active preview between
  `Clear`, `Night`, `Reader`, and `Invert`; the choice is kept across preview
  refreshes and newly opened PDFs.
- Keep the dark page background applied while a dark preview refreshes, avoiding
  a brief white page flash during PDF.js reload.
- Keep `dark-pages` as a compatibility alias for `night`.
- Keep `inverted` available as the fallback mode for scanned or image-heavy PDFs
  where page recoloring is not appropriate.
- Preserve the default `auto` appearance behavior for existing users.

## 1.4.8 (2026/04/28)

- Fix the toolbar `External` button and `Open Externally` command path so PDFs
  open through the system PDF handler instead of VS Code's binary/text fallback
  editor.
- Add packaged-artifact assertions that reject the old
  `vscode.openWith(..., 'default')` Source path.
- Relabel the toolbar action from `Source` to `External` and switch its icon to
  match the corrected behavior.
- Increase find-result highlight contrast, with a stronger active-match color
  in light, dark, and inverted themes.

## 1.4.7 (2026/04/28)

- Replace toolbar button text with inline SVG icons (chevrons, zoom, search, list-tree, printer, refresh, file-code) using a single SVG symbol block with currentColor strokes.
- Add icon+label structure to toolbar buttons with labels hidden below 720px container width using CSS container queries.
- Remove horizontal scroll from toolbar and use container-type: inline-size for responsive layout.
- Tighten toolbar gaps (8px→6px, 5px→4px) and make find input flex within its group.
- Add toolbar contract assertions to test suite for button structure, accessibility, and responsive CSS.

## 1.4.6 (2026/04/28)

- Fix the preview bootstrap race where the async PDF.js viewer module could
  finish evaluating after `DOMContentLoaded` had already fired, leaving the
  panel blank.
- Start the viewer immediately when the document is already ready, while still
  using the `DOMContentLoaded` listener for early-loading webviews.
- Use an absolutely positioned `div` for the PDF.js viewer container, matching
  the PDF.js 5 constructor contract and avoiding container validation startup
  failures.
- Polyfill `Map.prototype.getOrInsertComputed` and
  `WeakMap.prototype.getOrInsertComputed` (TC39 Stage 3 "Upsert" proposal) in
  `lib/polyfills.mjs`, imported before PDF.js. PDF.js 5.6.205 calls these
  methods during the first PDF render, but the V8 inside current VS Code
  Electron builds does not yet expose them; without the polyfill the
  toolbar status reports `Could not load PDF: this[#fr].getOrInsertComputed
is not a function`.
- Keep the local webview PDF data loading path from 1.4.5 and remove temporary
  diagnostic banner/logging instrumentation.

## 1.4.5 (2026/04/27) - superseded by 1.4.6

- Read the opened PDF through the webview frame and pass `Uint8Array` data to
  PDF.js, bypassing range/stream loading against VS Code webview-resource URLs
  that could leave the viewer stuck at `of 0`.
- Disable PDF.js range and streaming modes for local webview resources.
- This release was superseded because the async module loader could miss
  `DOMContentLoaded` and still leave the preview blank.

## 1.4.4 (2026/04/27)

- Load the PDF.js core module before dynamically importing the PDF.js viewer
  module so `globalThis.pdfjsLib` exists before PDF.js 5 evaluates
  `pdf_viewer.mjs`.
- Add an early webview bootstrap error handler that reports startup failures in
  the preview instead of leaving a blank panel.
- Rename the marketplace-facing extension display name to `vscode-pdf Next` and
  describe it as a modern successor to the classic `vscode-pdf` extension.

## 1.4.3 (2026/04/27)

- Restore `style-src 'unsafe-inline'` in the webview CSP because PDF.js 5 writes
  page, text-layer, annotation-layer, and scaling geometry through inline style
  properties at runtime. Scripts remain nonce-bound and eval remains disabled.

## 1.4.2 (2026/04/27)

- Disable retained hidden webview contexts so hidden PDF previews are recreated
  from the current extension bundle after local VSIX upgrades. This prevents
  stale panels from trying to load removed extension-resource paths.
- Smooth the webview toolbar with clearer focus states, button press feedback,
  tabular page/find counters, and less abrupt status updates.
- Add a regression assertion that the custom editor keeps retained webview
  contexts disabled.

## 1.4.1 (2026/04/27)

- Add commands for opening a PDF preview and reopening the active preview as raw
  PDF source.
- Add an outline sidebar for PDFs that provide bookmarks, wired to the existing
  `pdf-preview.default.sidebar` setting.
- Persist per-PDF page, zoom, and scroll state in workspace state and restore it
  on reopen unless an explicit URL hash is used.
- Keep previews open across temporary PDF delete/recreate cycles by default;
  `pdf-preview.reload.closeOnDelete` restores the old close-on-delete behavior.
- Add finite appearance settings for dark/inverted viewing and page spacing.
- Add lightweight in-viewer keyboard navigation shortcuts.
- Add a visible `Refresh` toolbar button, `PDF Preview Next: Refresh Preview`
  command, and `Ctrl+R` / `Cmd+R` in-viewer refresh.
- Debounce automatic refresh after file changes with
  `pdf-preview.reload.debounceMs`, preserving the previous rendered PDF and
  retrying once if a rebuild temporarily writes an incomplete file.
- Preserve manual outline-sidebar visibility across refreshes.
- Add a visible `Print` toolbar button and `PDF Preview Next: Print` command.
  The webview tries the browser print path first and falls back to opening the
  PDF externally when printing is unavailable.
- Improve hand-scroll behavior so text selection/copy and text dragging do not
  start pointer-captured drag scrolling.
- Add CI and tag-release workflows for tests, VSIX packaging, content scanning,
  GitHub release assets, VS Code Marketplace publishing, and Open VSX publishing
  when tokens are configured.
- Document which deprecated upstream issues are now covered and which editor/API
  requests remain out of scope.

## 1.4.0 (2026/04/27)

- Upgrade the vendored PDF.js runtime to `pdfjs-dist@5.6.205`.
- Replace the legacy global `PDFViewerApplication` integration with a small
  ESM viewer shell owned by this extension.
- Keep PDF.js eval and WASM execution disabled so the webview CSP does not need
  `unsafe-eval`, `wasm-unsafe-eval`, or inline styles.
- Preserve live-reload behavior without patching PDF.js private viewer
  internals.
- Add built-in page navigation, zoom, find, password prompt, and hand-scroll
  support for the new viewer shell.
- Add `npm run update:pdfjs` with a pinned JSONC manifest and npm integrity
  verification for future PDF.js upgrades.
- Remove the old PDF.js 3 full viewer, locales, source maps, and debugger
  artifacts from the vendored runtime.
- Do not package unused PDF.js scripting sandbox or WASM decoder binaries.

## 1.3.0 (2026/04/27)

- Harden webview configuration escaping for PDF paths containing HTML-sensitive
  characters.
- Resolve extension resource URIs with VS Code URI helpers for better
  cross-platform behavior.
- Fix PDF live reload by watching the opened file with a directory-relative
  pattern instead of passing an absolute path as a glob.
- Keep PDF.js reload cleanup reliable when a reload fails.
- Stop PDF.js from intercepting VS Code print and command-palette shortcuts.
- Add defensive support for PDF URL hash destinations.
- Keep PDF annotation popup text readable.
- Exclude PDF.js source maps and debugger files from packaged VSIX builds.
- Harden the webview CSP with nonce-based scripts and an explicit worker
  policy.
- Scope webview local resources to the extension and the opened PDF's
  containing directory.
- Disable PDF.js eval support while the PDF.js 5 migration is prepared.
- Simplify preview disposal and message handling.
- Modernize the TypeScript, ESLint, Prettier, VS Code test, and VSIX packaging
  toolchain.

## 1.2.3 (2026/04/27)

- Publish improved fork under the `pdf-preview-next` identity.
- Respect `pdf-preview.default.sidebar` during PDF.js startup, so persisted
  PDF.js sidebar history does not override the configured default.
- Replace the inherited icon with a new `PDF Preview Next` icon.
- Keep VS Code type definitions out of the runtime package.
- Document the project direction: simple, lightweight, robust, and fast.

## 1.2.2 (2022/12/23)

- Fix about rendering Unicode characters

## 1.2.1 (2022/12/12)

- Update PDF.js to 3.1.81-legacy
- Restore scroll position during reload (#136)
- Run under remote development (#100)

### Thank you

- @kfigiela Run extension locally when using remote development #100
- @Daniel-Atanasov fix: Fix scroll location and flickering during reload #136

## 1.2.0 (2021/12/15)

- Allow pdf viewer to work in an untrusted workspace (#102)
- Bump version of PDF.js to Stable (v2.10.377) (#120)

### Bug fixes

- Support Unicode in PDF by passing the right cMapUrl to pdf.js (#116)
- Preserve the current page number and zoom level on reload (#121)

### Thank you

- @lramos15 Added settings about untrusted workspaces. #102
- @aifreedom Fixed bug about Unicode charactors. #116
- @simon446 Bump pdf.js version. #120
- @zamzterz Fixed to preserve page number and scale on reload. #121

## 1.1.0 (2020/07/13)

- The issue about extension view is resolved.
  - Remove message shown on loaded.
- Support default viewer settings
  - cursor (**hand** or tool)
  - scale (**auto**, page-actual, etc...)
  - sidebar (**hide** or show)
  - scrollMode (**vertical**, horizontal or wrapped)
  - spreadMode (**none**, odd or even)

## 1.0.0 (2020/06/18)

- [Change extension API](https://github.com/microsoft/vscode/issues/77131)
- Resolve known issues about showing pdf preview.
- Upgrade PDF.js to 2.4.456

## 0.6.0 (2020/04/10)

- Support auto reload (#52)
- Migrate vscode-extension packages

### Thank you

- @GeorchW Implemented auto-refresh ( #11 ) #52

## 0.5.0 (2019/02/25)

- Recovery for working even VSCode 1.31.x.
- Avoid nested `<iframe>`.

## 0.4.3 (2018/11/28)

- Recovery for working even VSCode 1.30.0.

## 0.4.2 (2018/11/28)

- Revive display state on load VSCode.
- [Event-Stream Package Security Update](https://code.visualstudio.com/blogs/2018/11/26/event-stream)

## 0.4.0 (2018/11/9)

- Migrate vscode internal api. Due to [Microsoft/vscode#62630](https://github.com/Microsoft/vscode/issues/62630)
- Upgrade PDF.js to 2.1.36

## 0.3.0 (2018/6/6)

- Upgrade PDF.js to 1.9.426 (#23)

### Thank you

- @Kampfgnom bump to pdf.js version #23

## 0.2.0 (2017/1/12)

- Fixed displaying on linux (#5)
- Be able to open PDF from context menu in explorer now (#6)

### Thank you

- @serl support for context menu in explorer #6

## 0.1.0 (2016/11/30)

- Add extension icon.
- Use all PDF.js [Pre-built](https://mozilla.github.io/pdf.js/getting_started/#download) files.

## 0.0.2 (2016/11/24)

- consistent file icon

## 0.0.1 (2016/10/25)

- Initial release.
