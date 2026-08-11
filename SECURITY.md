# Security

## Reporting a Vulnerability

Please report security issues privately to the repository owner via GitHub
Security Advisories on
<https://github.com/ricardofrantz/pdf-preview-next/security/advisories/new>,
or by opening a minimal public issue asking for a private contact channel.

Do not include exploit details in public issues.

## Audit History

| Date       | Auditor          | Scope                                                | Result                       |
| ---------- | ---------------- | ---------------------------------------------------- | ---------------------------- |
| 2026-04-30 | Claude Opus 4.7  | `src/`, `lib/*.mjs`, `tools/`, workflows             | 0 actionable, 2 hardening    |
| 2026-04-29 | Pi security pass | release workflows, packaging, risky API pattern scan | 0 actionable findings        |
| 2026-04-27 | Claude Opus 4.7  | `src/`, CSP, vendored PDF.js, npm advisories         | 1 critical, 1 high, 2 medium |

The 2026-04-27 findings are remediated across `1.3.0` and `1.4.0`. The
2026-04-30 hardening items landed in the same pass.

### 2026-04-30 — Claude Opus 4.7

**Scope.** Repository-authored TypeScript and webview JavaScript (`src/`,
`lib/main.mjs`, `lib/polyfills.mjs`, `lib/pdf.worker-wrapper.mjs`),
`tools/scan_vsix.mjs`, and `.github/workflows/`. Vendored PDF.js excluded.

**Method.** Pattern scan for GitHub Actions injection, shell execution APIs,
dynamic code evaluation, browser XSS sinks, plus a manual review of the webview
message contract, CSP construction, and PDF link path-traversal handling.

**Findings.** No actionable findings. Two low-severity hardening items
addressed in the same pass:

- `release.yml` accepted any `release_tag` string from `workflow_dispatch`.
  Added a `^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$` regex check at the top
  of `validate_release` so malformed tags fail before `bun install` and before
  any shell expansion that depends on the tag value.
- Documented the trusted-workspace `printCommand` boundary below.

**Verified clean.**

- Webview CSP pins `script-src` to a per-render `crypto.randomBytes(16)` nonce
  plus `cspSource`; no `'unsafe-inline'` or `'unsafe-eval'`.
- Host-side message handler rejects unknown types and unknown keys via the
  closed allowlist in `src/webviewContract.ts`.
- `resolvePdfLinkTarget` rejects URI schemes, absolute paths, and any resolved
  target whose `path.relative` escapes the resource directory.
- `src/print.ts` and `tools/scan_vsix.mjs` use `spawn` / `execFileSync` with
  argument arrays; no shell expansion path.
- All dynamic DOM writes in `lib/main.mjs` use `textContent`. The single
  first-party `innerHTML` finding is inside vendored PDF.js and is out of
  scope per the boundary defined here.

**Trusted-workspace `printCommand`.** When the active workspace is trusted,
`pdf-preview.printCommand` is read from workspace settings and the resolved
binary is launched via `child_process.spawn` with an argument array.
`spawn(command, args)` does not invoke a shell, so a hostile workspace cannot
inject shell metacharacters, but the `command` itself is operator-controlled.
This is by design: VS Code Workspace Trust is the established boundary. Users
who do not trust a workspace fall back to `inspect().globalValue` /
`defaultValue`, so a malicious `.vscode/settings.json`
in an untrusted workspace cannot override the print command.

### 2026-04-29 — Pi security pass

**Scope.** Focused release-readiness review of `.github/workflows/`,
repository-authored source, VSIX packaging/scanner scripts, and production npm
advisories for the `2.0.0` public release.

**Method.** Pattern scan for GitHub Actions injection risks, shell execution
APIs (`exec`, `execSync`), dynamic code execution (`eval`, `new Function`),
browser XSS sinks (`innerHTML`, `document.write`, unsafe React HTML), Python
risky APIs, plus `npm audit --omit=dev --audit-level=high`.

**Findings.** No actionable findings.

**Verified clean.**

- GitHub Actions use `github.event` only in a top-level concurrency expression,
  not inside shell `run:` blocks.
- Third-party workflow actions are pinned by full commit SHA.
- Marketplace/Open VSX publish secrets are only exposed in the
  `marketplace-publish` environment-gated job.
- No repository-authored `exec`, `execSync`, `eval`, `new Function`,
  `innerHTML`, or `document.write` hits outside vendored PDF.js.
- `npm audit --omit=dev --audit-level=high` reports 0 vulnerabilities.
- `tools/scan_vsix.mjs` rejects source files, maps, tests, scratch/temp files,
  and missing PDF.js runtime assets in release packages.

**Status.** Release automation and packaged-artifact checks are suitable for the
`2.0.0` public release, assuming the GitHub `marketplace-publish` environment is
configured with required reviewers before registry tokens are added.

### 2026-04-27 — Claude Opus 4.7

**Scope.** Static review of `src/extension.ts`, `src/pdfProvider.ts`,
`src/pdfPreview.ts`, the webview Content-Security-Policy, the vendored
PDF.js version under `lib/`, `npm audit --omit=dev`, and the
`.github/workflows/` directory.

**Method.** Pattern scan for shell-execution APIs, dynamic code
evaluation, browser XSS sinks (innerHTML assignment, document write,
React unsafe HTML props), Python risky APIs (n/a — Node project),
GitHub Actions injection (n/a — no workflows), and a manual review of
the webview HTML construction and message channel.

**Findings.**

- **Critical** — Vendored PDF.js `3.1.81` was affected by **CVE-2024-4367**
  (arbitrary JavaScript execution via crafted PDF, fixed in 4.2.67).
  Remediated in `1.4.0` by migrating the vendored runtime to
  `pdfjs-dist@5.6.205`; PDF.js eval support remains disabled.
- **High** — Webview CSP used `script-src 'unsafe-inline'`, which
  defeats CSP's protection against script injection in the viewer.
  Remediated in `1.3.0` with a per-load script nonce.
- **Medium** — `localResourceRoots` needed tighter bounds. Remediated in
  `1.3.0` by limiting roots to the extension directory and the opened PDF's
  containing directory, which is the directory-style boundary VS Code webviews
  support for local resources.
- **Medium** — CSP omitted `worker-src`; PDF.js spawns a Web Worker.
  Remediated in `1.3.0`.

**Verified clean.**

- No shell-execution or dynamic code evaluation in repository-authored code.
- No unsafe HTML sinks in `src/`.
- `npm audit --omit=dev` reports 0 vulnerabilities.
- `npm audit --audit-level=high` reports 0 high or critical vulnerabilities;
  the remaining dev-only advisories are moderate findings in `@vscode/vsce`'s
  Azure auth dependency chain.
- No secrets, tokens, or API keys in source.
- No GitHub Actions workflows present, so no workflow-injection surface.

**Status.** Webview hardening and the PDF.js 5 runtime migration landed in
v1.4; PDF.js ran with JavaScript evaluation and WASM disabled.

**Update (2026-08).** The vendored runtime is now `pdfjs-dist@6.2.108`.
PDF.js 6 removed its eval-based font/PostScript code paths upstream, and the
release compat check (`tools/check_pdfjs_runtime_compat.mjs`) now asserts that
no `eval(` or `new Function(` exists anywhere in the vendored core, worker, or
viewer bundles — a stronger guarantee than the removed `isEvalSupported`
flag. PDF parsing runs in a real Web Worker (the webview never statically
imports the worker bundle onto the main thread), and the integration tests
assert the real worker spawns via the `viewer-ready` event's `workerType`
field. WASM execution remains disabled (`useWasm: false` with the OpenJPEG
JavaScript fallback). Document bytes now travel from the extension host to
the viewer over the webview message channel, so `localResourceRoots` is
restricted to the extension directory alone — the webview can no longer load
anything from the opened PDF's directory.
