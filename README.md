# vscode-pdf Next — fast, secure PDF viewing in VS Code

[![Version](https://img.shields.io/visual-studio-marketplace/v/RicardoFrantz.pdf-preview-next?label=Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=RicardoFrantz.pdf-preview-next)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/RicardoFrantz.pdf-preview-next?color=success)](https://marketplace.visualstudio.com/items?itemName=RicardoFrantz.pdf-preview-next)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/RicardoFrantz.pdf-preview-next)](https://marketplace.visualstudio.com/items?itemName=RicardoFrantz.pdf-preview-next&ssr=false#review-details)
[![Open VSX](https://img.shields.io/open-vsx/v/RicardoFrantz/pdf-preview-next?label=Open%20VSX)](https://open-vsx.org/extension/RicardoFrantz/pdf-preview-next)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](https://github.com/ricardofrantz/vscode-pdf-next/blob/main/LICENSE)

Open PDFs right inside VS Code — with **true dark mode**, instant live reload
for LaTeX and Typst builds, search, outline navigation, and a
security-hardened PDF.js 6 runtime.

**vscode-pdf Next** is the actively maintained successor to the classic
`tomoki1207.vscode-pdf` extension: same simplicity, modern renderer, and a
much stronger security posture.

<!-- Add a screenshot or GIF here — this is the single most impactful thing
     for Marketplace conversions. Suggested: a side-by-side of a .tex file and
     the live-reloading PDF preview in dark mode.
![vscode-pdf Next in action](docs/media/screenshot.png)
-->

## Why this extension?

- 🌙 **True dark mode.** Not just inverted colors — Night mode asks PDF.js to
  re-render page content for low-eye-strain reading, with auto theme matching
  and an inversion fallback for scanned documents. Your PDFs finally fit your
  dark setup.
- ⚡ **Fast.** Powered by the latest Mozilla PDF.js — currently
  `pdfjs-dist@6.2.108`, the same engine Firefox uses — with all PDF parsing
  and decoding in a dedicated worker thread so the interface never blocks.
  No telemetry, no network calls, no cloud round-trips: your PDFs never
  leave your machine.
- 🔒 **Secure by design.** Strict webview sandboxing, no shell execution,
  script eval and WASM disabled, and every release package automatically
  scanned before publishing. See the [security model](#security-model) below.
- 🔁 **Built for TeX/Typst workflows.** Debounced live reload keeps your page,
  zoom, and scroll position exactly where they were — even when your build
  tool deletes and recreates the PDF mid-compile.

## Features

- **Live reload** with debounce and focus preservation — ideal for
  `latexmk`, `tectonic`, `typst watch`, and similar build loops.
- **First-class WSL support**: PDFs on `\\wsl.localhost\...` shares load
  instantly and live-reload works even though VS Code's file watchers can't
  see WSL files (the extension polls as a fallback).
- **Per-PDF state restore**: page, zoom, scroll position, sidebar, and active
  panel come back exactly as you left them.
- **Text search and selection**, with optional copy-on-select.
- **Outline and thumbnail sidebars** for quick navigation in long documents.
- **Inter-PDF links** that work locally and preserve fragments like `#page=2`.
- **Keyboard-first navigation**: vim-style scrolling, paging, and zoom (see
  [shortcuts](#keyboard-shortcuts)).
- **Native printing** via your system viewer, plus an advanced direct-print
  command with a no-shell custom command override.

## Dark mode 🌙

Reading a blinding white PDF in a dark editor is miserable. vscode-pdf Next
ships a full range of appearance modes — cycle them from the toolbar or pin
one with `pdf-preview.appearance.theme`:

| Mode       | What it does                                                              |
| ---------- | ------------------------------------------------------------------------- |
| `auto`     | Follows your VS Code theme for the viewer chrome.                         |
| `dark`     | Dark viewer chrome, original page colors.                                 |
| `night`    | PDF.js re-renders page content in dark colors — real dark pages, not a CSS filter. |
| `reader`   | Reader-compatible night rendering.                                        |
| `inverted` | Full-page inversion fallback for scanned or image-heavy PDFs.             |

## Getting started

Install from the Marketplace (search for **"vscode-pdf Next"**) or from the
command line:

```bash
code --install-extension RicardoFrantz.pdf-preview-next
```

Then just open any `.pdf` file. To make this the default PDF viewer:

```json
"workbench.editorAssociations": {
  "*.pdf": "pdf-preview-next.preview"
}
```

Also available on [Open VSX](https://open-vsx.org/extension/RicardoFrantz/pdf-preview-next)
for VSCodium and friends, or as a VSIX from
[GitHub Releases](https://github.com/ricardofrantz/vscode-pdf-next/releases):

```bash
code --install-extension pdf-preview-next-<version>.vsix --force
```

## Keyboard shortcuts

| Keys                | Action                   |
| ------------------- | ------------------------ |
| `j` `k` `h` `l`     | Scroll                   |
| `n` / `p` (or `.` / `,`) | Next / previous page |
| `g` / `G`           | First / last page        |
| `+` / `-`           | Zoom in / out            |
| `Ctrl+R` / `Cmd+R`  | Refresh the preview      |

## Settings

| Setting                              | Default    | Notes                                                                                    |
| ------------------------------------ | ---------- | ---------------------------------------------------------------------------------------- |
| `pdf-preview.default.cursor`         | `select`   | Default cursor tool: `select` or `hand`.                                                 |
| `pdf-preview.default.scale`          | `auto`     | `auto`, `page-actual`, `page-fit`, `page-width`, or a numeric scale such as `1.25`.      |
| `pdf-preview.default.sidebar`        | `false`    | Open the sidebar by default when the selected panel is available.                        |
| `pdf-preview.default.sidebarPanel`   | `outline`  | Initial sidebar panel: `outline` or `thumbnails`.                                        |
| `pdf-preview.default.scrollMode`     | `vertical` | `vertical`, `horizontal`, or `wrapped`.                                                  |
| `pdf-preview.default.spreadMode`     | `none`     | `none`, `odd`, or `even`.                                                                |
| `pdf-preview.reload.automatic`       | `true`     | Auto-refresh previews when the PDF changes; manual reload always remains available.      |
| `pdf-preview.reload.debounceMs`      | `800`      | Delay after file-change notifications before refreshing.                                 |
| `pdf-preview.reload.closeOnDelete`   | `false`    | Close previews when a PDF is deleted; keep disabled for build tools that replace files.  |
| `pdf-preview.appearance.theme`       | `auto`     | `auto`, `light`, `dark`, `night`, `reader`, `dark-pages`, or `inverted`.                 |
| `pdf-preview.appearance.pageGap`     | `normal`   | `compact`, `normal`, or `wide`.                                                          |
| `pdf-preview.copy.autoCopySelection` | `false`    | Opt-in clipboard write when selected PDF text is released with the mouse.                |
| `pdf-preview.printCommand`           | empty      | Restricted custom print command; `{{file}}` is the PDF path. Runs without a shell and is ignored in untrusted workspaces. |

Settings prefixed `pdf-preview.default.*` and appearance/copy settings can be
overridden per workspace folder or resource. Reload settings are global because
they control file watching rather than rendering defaults.

## Commands

| Command                                               | Behavior                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `vscode-pdf Next: Open Preview`                       | Open the selected PDF with this viewer.                                        |
| `vscode-pdf Next: Open Externally`                    | Open the active PDF with the system PDF handler.                               |
| `vscode-pdf Next: Refresh Preview`                    | Refresh without losing page, zoom, scroll, or sidebar state.                   |
| `vscode-pdf Next: Open in System Viewer for Printing` | Open the PDF in your default PDF app for native printing.                      |
| `vscode-pdf Next: Print Directly to Default Printer`  | Advanced: run `pdf-preview.printCommand` or submit to the default CUPS printer. |
| `vscode-pdf Next: Reset View State`                   | Clear saved page, zoom, scroll, and sidebar state for the active PDF.          |

The toolbar also provides one-click controls for external open, appearance
mode cycling, sidebar toggling, printing, manual refresh, and an auto-reload
toggle.

## Security model

Rendering untrusted PDFs deserves real sandboxing, so this extension treats
security as a feature:

- **Current runtime: `pdfjs-dist@6.2.108`** (Mozilla's PDF.js), kept up to
  date with upstream security fixes.
- Webview scripts are **nonce-bound** with scoped `localResourceRoots`.
- **No dynamic code execution**: the vendored PDF.js 6 runtime contains no
  `eval` or `new Function` (verified by an automated check on every build),
  WASM execution is disabled, and the CSP forbids `unsafe-eval` anyway — a
  malicious PDF cannot run arbitrary code.
- **PDF parsing runs in a sandboxed worker thread**, keeping documents off the
  UI thread; the extension verifies at test time that the real worker spawns.
- The default print path performs **no shell execution**; the optional custom
  print command runs without a shell and is restricted under VS Code
  Workspace Trust.
- Every release VSIX passes an **automated package scanner** that rejects
  stray source files, maps, tests, and scratch files before publishing.
- **No telemetry, no network access** — everything renders locally.

The codebase was security-audited with **Claude Opus 4.7** (April 2026), and
release automation is hardened too: CI actions pinned by commit SHA and
publishing gated behind a protected environment. Details in
[SECURITY.md](https://github.com/ricardofrantz/vscode-pdf-next/blob/main/SECURITY.md).

## Coming from `tomoki1207.vscode-pdf`?

You'll feel at home — this project started as a security-hardened fork of that
much-loved extension. What you gain:

- PDF.js upgraded from an aging bundle to the current **PDF.js 6** line, with
  rendering in a real worker thread.
- Live reload that survives TeX-style delete-and-recreate builds.
- View-state restore, dark reading modes, outline/thumbnail sidebars.
- Active maintenance, a documented security model, and automated releases.

This extension is intentionally a *previewer*, not a PDF editor: editing,
persistent annotations, page rearranging, and cloud sync are out of scope —
it stays small, fast, and auditable.

## Contributing & development

Issues and PRs are welcome at
[ricardofrantz/vscode-pdf-next](https://github.com/ricardofrantz/vscode-pdf-next).
See [docs/RELEASING.md](docs/RELEASING.md) for building from source and the
release process, and [docs/MAINTENANCE.md](docs/MAINTENANCE.md) for the
maintenance playbook.

## Credits & license

Built on [Mozilla PDF.js](https://github.com/mozilla/pdf.js) and the original
[vscode-pdf](https://github.com/tomoki1207/vscode-pdfviewer) by tomoki1207.
MIT licensed — see [LICENSE](./LICENSE).
