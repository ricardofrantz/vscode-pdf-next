# Maintenance Guide

This extension is intentionally stable: do not add new product surface unless a user asks for it. Most future work should be dependency/runtime upkeep, security hardening, and compatibility fixes.

## Maintenance posture

- Keep the viewer small, local-first, and offline-capable.
- Prefer preserving behavior over redesigning flows during dependency updates.
- Treat PDF.js, VS Code, packaging, and release automation as the machinery that needs periodic care.
- Avoid new dependencies unless they replace fragile custom code or unblock a required platform update.

## Routine update cadence

Run this sweep when Dependabot/security tooling flags something meaningful, when VS Code raises extension-host requirements, or at least quarterly.

1. Start from a clean checkout.
2. Inspect current runtime pins:
   - `package.json` and `bun.lock` for Bun-managed dependencies.
   - `tools/update_pdfjs.jsonc` and `lib/PDFJS_VERSION` for PDF.js.
   - `.github/workflows/*.yml` for pinned actions and Node versions.
   - `.vscode-test/` only as local cache; never commit it.
3. Update one class of machinery at a time:
   - dev/build/test dependencies;
   - VS Code engine and `@types/vscode` / `@vscode/test-electron`;
   - PDF.js runtime assets;
   - GitHub Actions pins.
4. Run the full verification ladder before shipping.

## Verification ladder

Use the smallest useful check while iterating, then run all of this before release:

```bash
bun install --frozen-lockfile
bun run format:check
bun run typecheck
bun run lint
bun run test
bun run package -- --no-dependencies
bun run package:scan -- pdf-preview-next-<version>.vsix
code --install-extension pdf-preview-next-<version>.vsix --force
```

Manual smoke test after local install:

- Open a normal PDF, a password-protected PDF, an outline/bookmark PDF, and a link-heavy PDF.
- Verify page navigation, zoom, find, sidebar, refresh, open externally, and Print.
- Resize the editor to medium and narrow split widths; confirm toolbar actions do not clip.
- On macOS, confirm Print opens Preview/system viewer. On Linux, confirm `Print Directly` either submits to the default CUPS printer or falls back with a useful warning.

## Updating dependencies

1. Use `bun outdated` to decide whether updates are routine or major.
2. Update patch/minor dev dependencies first.
3. For major updates, read release notes before changing the lockfile.
4. Keep `package.json` and `bun.lock` synchronized via Bun, not manual edits.
5. Re-run `bun audit` after updates. Prefer upgrading over suppressing; document any accepted advisory in `SECURITY.md`.

## Updating VS Code compatibility

When bumping `engines.vscode`, `@types/vscode`, or `@vscode/test-electron`:

- Check the VS Code API changelog for custom editor, webview, URI, and workspace trust changes.
- Keep the minimum engine as low as practical; only raise it for a concrete API/runtime need.
- Run tests against the minimum supported VS Code version if practical, not only your installed VS Code.
- Verify command titles, activation events, custom editor registration, and webview resource loading.

## Updating PDF.js

PDF.js is the highest-risk routine update because this repo vendors runtime assets.

1. Update `tools/update_pdfjs.jsonc` with the target `pdfjs-dist` version and npm integrity.
2. Run:

   ```bash
   bun run update:pdfjs
   ```

3. Review generated changes in `lib/PDFJS_VERSION` and `lib/pdfjs/`.
4. Re-run compatibility checks through `bun run test` and `bun run package:scan -- <vsix>`.
5. Manually test rendering, text selection, find highlights, links, password prompts, outlines, thumbnails, and dark/night/reader modes.
6. Re-check `tools/check_pdfjs_runtime_compat.mjs` if PDF.js changes import names, worker setup, CSS variables, eval/WASM options, or viewer event behavior.

## Updating GitHub Actions

- Keep third-party actions pinned to full commit SHAs.
- Preserve release safety gates: tag/version matching, dry-run default, explicit confirmation phrase, and `marketplace-publish` environment approval.
- Re-run workflow syntax mentally and with a dry-run release if practical.
- Do not weaken `bun install --frozen-lockfile`, package scanning, or tag validation to make a release pass.

## Security review triggers

Run a focused security pass when changes touch:

- `src/print.ts` or any `child_process` use;
- webview HTML/CSS/JS, message contracts, CSP, or resource roots;
- PDF link/path resolution;
- `.github/workflows/`;
- package contents or release scripts.

Check for shell injection, webview XSS sinks, workspace trust bypasses, unsafe PDF.js execution options, path traversal, and workflow injection. Record meaningful audits in `SECURITY.md`.

## Release checklist

- Version and changelog are updated.
- No scratch files, VSIX artifacts, logs, `.work/` outputs, `.vscode-test/`, `out/`, or `dist/` surprises are staged unless expected.
- `bun run test` and package scan pass.
- Locally installed VSIX has been smoke-tested.
- Optional: dry-run the Release workflow before cutting a public release.
- Push `vX.Y.Z` to publish automatically (GitHub Release + Marketplace + optional Open VSX).
- Ensure `VSCE_PAT` is configured; `OVSX_PAT` is optional.
- Keep third-party actions SHA-pinned. Tag pushes publish after verify; manual
  `workflow_dispatch` still requires `dry_run=false` and `confirm_publish=publish vX.Y.Z`.

## Non-goals for maintenance

Do not add these during routine upkeep unless a real user need appears:

- editing/annotations;
- cloud sync;
- broad automation APIs;
- new toolbar features beyond preserving current functionality;
- alternate rendering engines.
