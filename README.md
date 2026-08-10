# vscode-pdf Next

Modern, lightweight PDF viewer for VS Code.

`vscode-pdf Next` is Ricardo's security-hardened successor to the classic
`tomoki1207.vscode-pdf` preview extension. It focuses on fast local PDF
viewing, predictable reload behavior, and a small packaged runtime.

## Features

- PDF.js 5 viewer runtime bundled for VS Code webviews.
- Live reload with debounce and focus preservation for TeX/Typst-style build
  loops.
- Outline and bounded thumbnail sidebars.
- Per-PDF view-state restore for page, zoom, scroll, sidebar, and active sidebar
  panel.
- Appearance modes for clear, dark chrome, Night, Reader-compatible Night, and
  full inversion fallback.
- Local inter-PDF links that preserve fragments such as `#page=2`.
- Host-side print command with a no-shell custom command override.
- Keyboard navigation for scrolling, paging, first/last page, and zoom.

## Install

### From Marketplace or Open VSX

Install `RicardoFrantz.pdf-preview-next` from the VS Code Marketplace or Open
VSX. In VS Code, run:

```bash
code --install-extension RicardoFrantz.pdf-preview-next
```

### From a VSIX release

Download the VSIX from the GitHub release and install it directly:

```bash
code --install-extension pdf-preview-next-<version>.vsix --force
```

To make VS Code use this viewer for PDFs:

```json
"workbench.editorAssociations": {
  "*.pdf": "pdf-preview-next.preview"
}
```

## Releasing (automatic Marketplace publish)

Pushing a version tag publishes automatically via GitHub Actions:

1. Bump `version` in `package.json` and update `CHANGELOG.md`.
2. Commit on `main`, then tag and push:

   ```bash
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

3. The **Release** workflow verifies, packages the VSIX, creates/updates the
   GitHub Release, then publishes to:
   - VS Code Marketplace (`VSCE_PAT` secret — required)
   - Open VSX (`OVSX_PAT` secret — optional)

Manual dry-run (no publish): **Actions → Release → Run workflow** with
`dry_run=true`. Manual publish without a new tag: `dry_run=false` and
`confirm_publish=publish vX.Y.Z`.

### Secrets

| Secret     | Where                                              | Purpose                          |
| ---------- | -------------------------------------------------- | -------------------------------- |
| `VSCE_PAT` | Repo or `marketplace-publish` environment          | Marketplace Manage scope PAT     |
| `OVSX_PAT` | Repo or `marketplace-publish` environment          | Open VSX personal access token   |

Create the Azure DevOps PAT with **Marketplace → Manage**, organization
**All accessible organizations**, then:

```bash
gh secret set VSCE_PAT -R ricardofrantz/vscode-pdf-next
# optional:
gh secret set OVSX_PAT -R ricardofrantz/vscode-pdf-next
```

## Settings

| Setting                            | Scope    | Default    | Notes                                                                                   |
| ---------------------------------- | -------- | ---------- | --------------------------------------------------------------------------------------- |
| `pdf-preview.default.cursor`       | resource | `select`   | Default cursor tool: `select` or `hand`.                                                |
| `pdf-preview.default.scale`        | resource | `auto`     | `auto`, `page-actual`, `page-fit`, `page-width`, or numeric scale such as `1.25`.       |
| `pdf-preview.default.sidebar`      | resource | `false`    | Opens the sidebar by default when the selected panel is available.                      |
| `pdf-preview.default.sidebarPanel` | resource | `outline`  | Initial sidebar panel: `outline` or `thumbnails`.                                       |
| `pdf-preview.default.scrollMode`   | resource | `vertical` | `vertical`, `horizontal`, or `wrapped`.                                                 |
| `pdf-preview.default.spreadMode`   | resource | `none`     | `none`, `odd`, or `even`.                                                               |
| `pdf-preview.reload.closeOnDelete` | window   | `false`    | Close previews when a PDF is deleted; keep disabled for build tools that replace files. |
| `pdf-preview.reload.automatic`     | window   | `true`     | Automatically refresh previews when the PDF changes; manual reload always remains available. |
| `pdf-preview.reload.debounceMs`    | window   | `800`      | Delay after file-change notifications before refreshing.                                |
| `pdf-preview.appearance.theme`     | resource | `auto`     | `auto`, `light`, `dark`, `night`, `reader`, `dark-pages`, or `inverted`.                |
| `pdf-preview.appearance.pageGap`   | resource | `normal`   | `compact`, `normal`, or `wide`.                                                         |
| `pdf-preview.copy.autoCopySelection` | resource | `false`  | Opt-in clipboard write when selected PDF text is released with the mouse.               |
| `pdf-preview.printCommand`         | resource | empty      | Restricted custom print command. Use `{{file}}` for the PDF path; otherwise the path is appended. Workspace/resource values are ignored when the workspace is untrusted. |

Resource-scoped settings can be overridden per workspace folder or PDF resource
where VS Code supports resource configuration. Reload settings remain global
because they control file watching rather than document rendering defaults. Custom
print commands execute local programs without a shell and are restricted under
VS Code Workspace Trust. The toolbar Print action deliberately opens the PDF in
the system viewer; direct queue printing is available through the separate
`vscode-pdf Next: Print Directly to Default Printer` command.

## Commands And Controls

| Command / control                    | Behavior                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `vscode-pdf Next: Open Preview`      | Open the selected PDF with this viewer.                                                          |
| `vscode-pdf Next: Open Externally`   | Open the active PDF with the system PDF handler.                                                 |
| `vscode-pdf Next: Refresh Preview`   | Refresh the active preview without losing page, zoom, scroll, or sidebar state.                  |
| `vscode-pdf Next: Open in System Viewer for Printing` | Open the PDF in Preview/default PDF app so the user can print with native options. |
| `vscode-pdf Next: Print Directly to Default Printer` | Advanced: run `pdf-preview.printCommand` or submit to the default CUPS printer with diagnostics. |
| `vscode-pdf Next: Reset View State` | Clear saved page, zoom, scroll, sidebar visibility, and active sidebar panel for the active PDF. |
| Toolbar `External`                   | Open the PDF with the system PDF handler.                                                        |
| Toolbar page-mode button             | Cycle Clear, Night, Reader, and Invert modes.                                                    |
| Toolbar sidebar button               | Show or hide outline/bookmark and thumbnail panels.                                              |
| Toolbar `Print`                      | Open the PDF in the system viewer for reliable native printing.                                  |
| Toolbar `Refresh`                    | Force-refresh the current PDF immediately.                                                       |
| Toolbar `Auto`                       | Toggle file-watcher automatic reload without disabling manual refresh.                           |
| `Ctrl+R` / `Cmd+R`                   | Refresh the current PDF.                                                                         |
| `j/k/h/l`                            | Scroll.                                                                                          |
| `n/p` or `./,`                       | Move pages.                                                                                      |
| `g/G`                                | Jump to first/last page.                                                                         |
| `+/-`                                | Zoom in/out.                                                                                     |

## Security Model

This repository has been security-audited by **Claude Opus 4.7** (April 2026).
The current runtime uses `pdfjs-dist@5.6.205` with:

- nonce-bound webview scripts;
- scoped `localResourceRoots`;
- explicit PDF.js worker loading;
- PDF.js eval and WASM execution disabled;
- no shell execution for the default print path;
- a packaged artifact scanner that rejects source files, maps, tests, scratch
  files, and missing runtime assets.

## Build From Source

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test
bun run package -- --no-dependencies
bun run package:scan -- pdf-preview-next-<version>.vsix
```

Useful scripts:

| Script                           | Purpose                                               |
| -------------------------------- | ----------------------------------------------------- |
| `bun run compile`                | Compile TypeScript to `out/` for the test runner.     |
| `bun run bundle`                 | Bundle the extension host to `dist/extension.js`.     |
| `bun run typecheck`              | Run TypeScript without emitting files.                |
| `bun run watch`                  | Run TypeScript and esbuild watchers together.         |
| `bun run package:scan:test`      | Unit-test the VSIX scanner matchers.                  |
| `bun run package:scan -- <vsix>` | Verify release package contents and viewer contracts. |

The release workflow is guarded for maintainers: third-party actions are pinned
by full commit SHA, CI/release jobs use concurrency groups, and tag pushes only
verify/package the release. GitHub Release, Marketplace, and Open VSX publishing
require a manual `workflow_dispatch` run with `dry_run=false`, a matching
`confirm_publish` phrase, and approval through the `marketplace-publish` GitHub
environment. Configure that environment with required reviewers before adding
publish tokens.

## Maintenance

The extension is intentionally stable. Routine work should mostly be dependency,
PDF.js, VS Code, packaging, and release-infrastructure upkeep rather than new
features. See [docs/MAINTENANCE.md](docs/MAINTENANCE.md) for the update cadence,
verification ladder, PDF.js upgrade flow, security-review triggers, and release
checklist.

### Upgrade PDF.js

1. Update `tools/update_pdfjs.jsonc` with the target `pdfjs-dist` version and
   npm integrity value.
1. Run:

   ```bash
   bun run update:pdfjs
   ```

1. Verify with `bun run typecheck`, `bun run lint`, `bun run test`, and
   `bun run package:scan -- <vsix>`.

## Known Non-goals

This extension is intentionally a previewer, not a PDF editor or platform API.
The following remain out of scope unless the project direction changes:

- PDF editing;
- persistent annotations;
- delete-pages or rearrange-pages support;
- a public cross-extension PDF.js API;
- cloud synchronization or document storage;
- broad automation features unrelated to previewing local PDFs.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

Please see [LICENSE](./LICENSE).
