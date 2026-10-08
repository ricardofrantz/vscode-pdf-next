# Threat model: vscode-pdf-next (Marketplace: pdf-preview-next)

## What this project does and where untrusted input enters
A VS Code extension that opens `*.pdf` files in a custom editor. The extension host
(Node, `src/`) reads the file and sends its bytes to a webview, where a vendored copy
of Mozilla PDF.js (`lib/pdfjs/`) renders it. Our viewer code in the webview is
`lib/main.mjs`, `lib/pageMode.mjs`, `lib/polyfills.mjs` and
`lib/pdf.worker-wrapper.mjs`.

Untrusted input:
- The PDF file. Assume every PDF is hostile: users open papers, invoices and
  attachments from anywhere. This includes links, outlines, annotations, forms,
  embedded fonts and images, and JavaScript actions inside the PDF.
- Messages from the webview to the extension host. Treat the webview as compromised
  once a hostile PDF is open: everything it posts is untrusted. The host validates
  them against a closed allowlist in `src/webviewContract.ts` and handles them in
  `src/pdfPreview.ts` (`onDidReceiveMessage`).
- An untrusted workspace (VS Code Restricted Mode). Workspace settings such as
  `pdf-preview.printCommand` must not take effect there (`src/print.ts`,
  `printCommandForResource`).

Trusted: user settings, and workspace settings in a trusted workspace. The print
command in a trusted workspace runs by design.

## Components that matter most / least
- Most: the webview Content Security Policy and nonce handling (`src/pdfPreview.ts`);
  the message contract (`src/webviewContract.ts`); PDF link handling
  (`resolvePdfLinkTarget`, `open-pdf-link`), which must accept only relative links to
  local `.pdf` files and must not escape the PDF's folder or reach any URI scheme,
  `command:` included; `open-external`, which opens the current PDF in the operating
  system's default application and which the webview can send without a click;
  `src/print.ts` (`spawn` with an argument array, workspace trust check);
  `localResourceRoots`.
- In scope: our webview code in `lib/*.mjs` (DOM writes, `copy-text`, view state), and
  the PDF.js options we set (scripting, eval, XFA, WASM decoders).
- WebAssembly image decoders: PDF.js 6.4.299 runs `lib/pdfjs/wasm/jbig2.wasm` and
  `openjpeg.wasm` (C code compiled to WebAssembly) on JBIG2 and JPEG 2000 images taken
  from the PDF (`useWasm: true` in `lib/main.mjs`). The CSP allows `'wasm-unsafe-eval'`
  for them and still forbids `'unsafe-eval'` (`src/pdfPreview.ts`). Memory corruption
  in a decoder stays inside the WebAssembly sandbox; it matters when it gives control
  of script in the webview.
- PDF.js itself: a PDF.js bug counts when it is reachable with the version and options
  we ship and it escapes the PDF.js sandbox, for example script running in the webview.
  We forward such reports to Mozilla. Crashes or slow rendering inside PDF.js alone
  are out of scope.
- Out of scope: `tools/` (release and packaging scripts), `docs/`, test fixtures.

## How to exercise it
- `xvfb-run -a node ./out/src/test/runTest.js` runs the integration tests in the VS
  Code build already in `.vscode-test/` (version 1.95.0). Test PDFs are in
  `src/test/fixtures/` (including `broken.pdf`, `password.pdf`, link and outline cases).
- `bun run test:compat` checks the vendored PDF.js against the viewer's runtime contract.
- `node ./tools/scan_vsix.mjs <file.vsix>` checks a packaged extension.

## How we rate severity
- Critical: a PDF that runs code in the extension host (Node), runs a program on the
  machine, or reads or writes files outside what the viewer needs, with no user action
  beyond opening the file.
- High: script running in the webview from a PDF (CSP bypass or DOM injection); a PDF
  or webview message that makes the host open an arbitrary URI, a `command:` URI, or a
  file outside the PDF's folder; a workspace setting taking effect in Restricted Mode.
- Medium: the same as High but needing one further click on something the user would
  not expect to be dangerous; leaking the local file path or file content to the network.
- Low: a PDF that crashes or freezes the viewer tab; spoofed UI inside the webview.

## Anything to leave alone
- A slow or failed render of a valid but large PDF.
- The trusted-workspace `pdf-preview.printCommand`, which runs an operator-chosen
  program by design (it is launched without a shell).
- Known PDF.js upstream issues already fixed in a newer PDF.js release: report them
  as "update PDF.js", one report for all of them.
