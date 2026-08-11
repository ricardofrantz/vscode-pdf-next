# Releasing and maintainer notes

This document covers release automation, publishing secrets, and PDF.js
upgrades. For day-to-day maintenance cadence see
[MAINTENANCE.md](MAINTENANCE.md).

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

## Secrets

| Secret     | Where                                     | Purpose                        |
| ---------- | ----------------------------------------- | ------------------------------ |
| `VSCE_PAT` | Repo or `marketplace-publish` environment | Marketplace Manage scope PAT   |
| `OVSX_PAT` | Repo or `marketplace-publish` environment | Open VSX personal access token |

Create the Azure DevOps PAT with **Marketplace → Manage**, organization
**All accessible organizations**, then:

```bash
gh secret set VSCE_PAT -R ricardofrantz/vscode-pdf-next
# optional:
gh secret set OVSX_PAT -R ricardofrantz/vscode-pdf-next
```

## Release workflow guardrails

The release workflow is guarded for maintainers: third-party actions are pinned
by full commit SHA, CI/release jobs use concurrency groups, and tag pushes only
verify/package the release. GitHub Release, Marketplace, and Open VSX publishing
require a manual `workflow_dispatch` run with `dry_run=false`, a matching
`confirm_publish` phrase, and approval through the `marketplace-publish` GitHub
environment. Configure that environment with required reviewers before adding
publish tokens.

## Upgrade PDF.js

1. Update `tools/update_pdfjs.jsonc` with the target `pdfjs-dist` version and
   npm integrity value.
2. Run:

   ```bash
   bun run update:pdfjs
   ```

3. Verify with `bun run typecheck`, `bun run lint`, `bun run test`, and
   `bun run package:scan -- <vsix>`.

## Build from source

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
