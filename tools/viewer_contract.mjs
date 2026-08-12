import assert from 'node:assert/strict';

const toolbarButtonIds = [
  'previous',
  'next',
  'zoomOut',
  'zoomIn',
  'findPrevious',
  'findNext',
  'themeToggle',
  'outlineToggle',
  'print',
  'reload',
  'openSource',
];

const iconOnlyButtonIds = new Set(['zoomOut', 'zoomIn']);

export function assertViewerContract({
  webviewSource,
  stylesSource,
  viewerScriptSource,
  context = 'viewer',
}) {
  assert.doesNotMatch(
    webviewSource,
    /executeCommand\(['"]vscode\.openWith['"],\s*this\.resource,\s*['"]default['"]/,
    `${context}: external-open action must not use VS Code's binary/text fallback editor.`,
  );
  // A build rewrites the PDF over hundreds of milliseconds and the watcher
  // fires when the write starts, so the bytes have to be checked, not timed.
  assert.match(
    webviewSource,
    /readWhenComplete\([\s\S]*?pdfLooksComplete\(data\)[\s\S]*?INCOMPLETE_READ_BUDGET_MS/,
    `${context}: a half-written PDF must be waited out, not sent to the viewer to fail on.`,
  );
  assert.match(
    webviewSource,
    /const data = await this\.readWhenComplete\(requestId, startedAt\)/,
    `${context}: document bytes must go through the completeness check on the way to the webview.`,
  );
  assert.match(
    webviewSource,
    /async openSource\([^)]*\)\s*{[\s\S]*?await this\.openExternal\(\);[\s\S]*?}/,
    `${context}: external-open action must open PDFs externally.`,
  );
  assert.match(
    webviewSource,
    /<button id="openSource"[^>]*title="Open PDF with system viewer"[^>]*aria-label="Open PDF with system viewer"/,
    `${context}: external-open toolbar button must describe the system viewer behavior.`,
  );
  assert.match(
    webviewSource,
    /<button id="openSource"[^>]*>[\s\S]*?<use href="#icon-external-link"\/>[\s\S]*?<span class="label">External<\/span>/,
    `${context}: external-open toolbar button must use the external-link icon and label.`,
  );
  assert.doesNotMatch(
    webviewSource,
    /<button id="openSource"[^>]*>[\s\S]*?<span class="label">Source<\/span>/,
    `${context}: external-open toolbar button should not be labeled Source.`,
  );
  assert.match(
    webviewSource,
    /<button id="themeToggle"[^>]*title="Switch PDF page mode to Night"[^>]*aria-label="Switch PDF page mode to Night"[^>]*aria-pressed="false"[^>]*>[\s\S]*?<use href="#icon-theme"\/>[\s\S]*?<span class="label">Clear<\/span>/,
    `${context}: theme cycle button must expose a pressed state, next-mode label, and icon.`,
  );
  assert.match(
    webviewSource,
    /<div class="sidebar-tabs" role="tablist" aria-label="Sidebar panels">[\s\S]*?<button id="outlinePanelTab"[^>]*role="tab"[^>]*aria-selected="true"[^>]*aria-controls="outlinePanel">Outline<\/button>[\s\S]*?<button id="thumbnailPanelTab"[^>]*role="tab"[^>]*aria-selected="false"[^>]*aria-controls="thumbnailPanel">Thumbnails<\/button>/,
    `${context}: viewer must include accessible sidebar panel tabs.`,
  );
  assert.match(
    webviewSource,
    /<section id="thumbnailPanel"[^>]*class="sidebar-panel thumbnail-panel hidden"[^>]*aria-label="Page thumbnails"[^>]*hidden>[\s\S]*?<div id="thumbnailList" class="thumbnail-list" aria-label="Page thumbnails"><\/div>/,
    `${context}: viewer must include the thumbnail sidebar panel shell.`,
  );

  for (const buttonId of toolbarButtonIds) {
    assert.match(
      webviewSource,
      new RegExp(`<button id="${buttonId}"`),
      `${context}: toolbar button ${buttonId} must exist.`,
    );
    assert.match(
      webviewSource,
      new RegExp(`<button id="${buttonId}"[^>]*aria-label="[^"]+"`),
      `${context}: toolbar button ${buttonId} must have aria-label.`,
    );

    const buttonPattern = iconOnlyButtonIds.has(buttonId)
      ? `<button id="${buttonId}"[^>]*>[\\s\\S]*?<svg class="icon"[\\s\\S]*?</svg>[\\s\\S]*?</button>`
      : `<button id="${buttonId}"[^>]*>[\\s\\S]*?<svg class="icon"[\\s\\S]*?</svg>[\\s\\S]*?<span class="label">`;
    assert.match(
      webviewSource,
      new RegExp(buttonPattern),
      iconOnlyButtonIds.has(buttonId)
        ? `${context}: toolbar button ${buttonId} must contain svg.icon.`
        : `${context}: toolbar button ${buttonId} must contain svg.icon and span.label.`,
    );
  }

  assert.doesNotMatch(
    stylesSource,
    /#pdf-toolbar[^}]*overflow-x:\s*auto/,
    `${context}: #pdf-toolbar should not use overflow-x: auto.`,
  );
  assert.match(
    stylesSource,
    /#pdf-root[^}]*container-type:\s*inline-size/,
    `${context}: #pdf-root must use container-type: inline-size for responsive toolbar queries.`,
  );
  assert.doesNotMatch(
    stylesSource,
    /#pdf-toolbar[^}]*container-type:\s*inline-size/,
    `${context}: #pdf-toolbar must not be its own query container because container queries cannot style the container itself.`,
  );
  assert.match(
    stylesSource,
    /button\.is-active\s*{[^}]*background:\s*var\(--vscode-button-secondaryBackground\)/s,
    `${context}: active toolbar buttons must have a visible active state.`,
  );
  assert.match(
    stylesSource,
    /\.pdfViewer\s*{[^}]*--page-bg-color:\s*#fff/s,
    `${context}: default PDF page background must be defined at viewer level.`,
  );
  assert.doesNotMatch(
    stylesSource,
    /\.pdfViewer\s+\.page\s*{[^}]*--page-bg-color:\s*#fff/s,
    `${context}: page-level white background must not override night mode during reload.`,
  );
  assert.match(
    stylesSource,
    /body\.theme-night\s+\.pdfViewer,\s*body\.theme-dark-pages\s+\.pdfViewer\s*{[^}]*--page-bg-color:\s*#1b1b1b/s,
    `${context}: night mode must set page background before PDF.js page shells render.`,
  );
  assert.match(
    stylesSource,
    /body\.theme-reader\s+\.pdfViewer\s*{[^}]*--page-bg-color:\s*#f4ecd8/s,
    `${context}: reader mode must set the sepia page background before PDF.js page shells render.`,
  );
  assert.match(
    stylesSource,
    /@container\s*\(max-width:\s*1160px\)[^{]*{[^}]*\.label[^}]*display:\s*none/,
    `${context}: @container query must hide labels before split/diff-width toolbars clip actions.`,
  );
  assert.match(
    stylesSource,
    /\.icon-button\s*{[^}]*flex-shrink:\s*0;/s,
    `${context}: icon toolbar buttons must not shrink text into their borders.`,
  );
  assert.match(
    stylesSource,
    /\nbutton\s*{[^}]*background:\s*transparent;[^}]*border:\s*1px solid transparent;/s,
    `${context}: toolbar buttons must be borderless like VS Code action bars, not filled like inputs.`,
  );
  assert.match(
    stylesSource,
    /button:hover:not\(:disabled\)\s*{[^}]*background:\s*var\(--vscode-toolbar-hoverBackground\)/s,
    `${context}: toolbar buttons must show the VS Code toolbar hover background.`,
  );
  assert.doesNotMatch(
    stylesSource,
    /button:active:not\(:disabled\)\s*{[^}]*transform:\s*scale/s,
    `${context}: button presses must swap background like VS Code, not scale like a web app.`,
  );
  assert.match(
    stylesSource,
    /#status\s*{[^}]*position:\s*absolute;/s,
    `${context}: status must float over the document so load errors survive narrow panes.`,
  );
  assert.doesNotMatch(
    stylesSource,
    /@container\s*\(max-width:\s*1160px\)[\s\S]*?#status[^}]*clip:\s*rect/,
    `${context}: status must never be clipped to a screen-reader-only box; it carries load errors.`,
  );
  assert.match(
    stylesSource,
    /@container\s*\(max-width:\s*420px\)[\s\S]*?body\.find-open \.toolbar-find\s*{[^}]*display:\s*inline-flex;/s,
    `${context}: Ctrl+F must be able to reveal the find group in very narrow toolbars.`,
  );
  assert.match(
    stylesSource,
    /\.pdfViewer\s+\.page\s*{[^}]*box-shadow:/s,
    `${context}: pages must have a visible edge; PDF.js 6 renders them without one.`,
  );
  assert.match(
    stylesSource,
    /body\.theme-inverted\s+\.pdfViewer\s+\.page\s+\.canvasWrapper\s*{[^}]*filter:\s*invert\(1\)/s,
    `${context}: inverted mode must invert only the canvas, or it also inverts find highlights.`,
  );
  assert.doesNotMatch(
    stylesSource,
    /body\.theme-light\s+#viewerContainer\s*{[^}]*background:\s*#/s,
    `${context}: viewer chrome must derive from the active VS Code theme, not hardcoded hex.`,
  );
  assert.match(
    stylesSource,
    /#pdf-root[^}]*container-type:\s*inline-size/,
    `${context}: pdf root must provide the toolbar container query so toolbar self-styles can respond.`,
  );
  assert.doesNotMatch(
    stylesSource,
    /#pdf-toolbar[^}]*container-type:\s*inline-size/,
    `${context}: toolbar must not be its own query container because container queries cannot style the container itself.`,
  );
  assert.match(
    stylesSource,
    /\.toolbar-group\.toolbar-find\s*{[^}]*flex:\s*1 1 180px;[^}]*min-width:\s*0;/s,
    `${context}: find toolbar group must shrink before right-side actions are clipped.`,
  );
  assert.match(
    stylesSource,
    /\.toolbar-find input\[type='search'\]\s*{[^}]*min-width:\s*0;/s,
    `${context}: find input must be allowed to shrink in narrow toolbars.`,
  );
  assert.match(
    stylesSource,
    /\.toolbar-spacer\s*{[^}]*min-width:\s*0;/s,
    `${context}: toolbar spacer must be shrinkable before responsive compaction.`,
  );
  assert.match(
    stylesSource,
    /@container\s*\(max-width:\s*1160px\)[\s\S]*?\.toolbar-spacer\s*{[^}]*display:\s*none;/,
    `${context}: toolbar spacer must collapse on medium widths so actions stay in view.`,
  );
  assert.match(
    stylesSource,
    /@container\s*\(max-width:\s*420px\)[\s\S]*?\.toolbar-find[\s\S]*?display:\s*none;/,
    `${context}: very narrow toolbar mode must collapse the find group rather than clipping primary actions.`,
  );
  assert.match(
    stylesSource,
    /@container\s*\(max-width:\s*420px\)[\s\S]*?#zoomOut,[\s\S]*?#zoomIn[\s\S]*?display:\s*none;/,
    `${context}: very narrow toolbar mode must collapse secondary zoom buttons rather than clipping primary actions.`,
  );
  assert.match(
    stylesSource,
    /\.sidebar-tab\.is-active\s*{[^}]*background:\s*var\(--vscode-list-activeSelectionBackground\)/s,
    `${context}: sidebar panel tabs must expose active selection state.`,
  );
  assert.match(
    stylesSource,
    /\.thumbnail-list\s*{[^}]*display:\s*flex;[^}]*flex-direction:\s*column/s,
    `${context}: thumbnail panel must stack page thumbnails vertically.`,
  );
  assert.match(
    stylesSource,
    /\.thumbnail-canvas-shell\s*{[^}]*min-height:\s*150px;[^}]*border:\s*1px solid var\(--vscode-panel-border\)/s,
    `${context}: thumbnail canvas shell must reserve stable space without decorative cards.`,
  );
  assert.match(
    stylesSource,
    /\.textLayer\s+\.highlight\s*{[^}]*--highlight-bg-color:\s*rgb\(255 213 74 \/ 0\.95\)/s,
    `${context}: find matches must have a visible highlight color.`,
  );
  assert.match(
    stylesSource,
    /\.textLayer\s+\.highlight\s*{[^}]*--highlight-selected-bg-color:\s*rgb\(255 128 42 \/ 0\.98\)/s,
    `${context}: selected find match must have a stronger highlight color.`,
  );
  assert.doesNotMatch(
    stylesSource,
    /\.textLayer\s*{[^}]*opacity:\s*0\.[0-9]+/s,
    `${context}: text layer opacity must not dim find highlights.`,
  );
  assert.match(
    stylesSource,
    /body\.theme-dark\s+\.textLayer\s+\.highlight\.selected,\s*body\.theme-night\s+\.textLayer\s+\.highlight\.selected,\s*body\.theme-dark-pages\s+\.textLayer\s+\.highlight\.selected,\s*body\.theme-inverted\s+\.textLayer\s+\.highlight\.selected\s*{/,
    `${context}: dark, night, dark-pages, and inverted themes must override selected find highlight; reader uses the light-paper highlight on sepia pages.`,
  );

  if (viewerScriptSource) {
    assert.match(
      viewerScriptSource,
      /function applyPageColorVariables\(viewer, theme\)\s*{[\s\S]*?viewer\.style\.setProperty\(['"]--page-bg-color['"], pageColors\.background\);[\s\S]*?viewer\.style\.removeProperty\(['"]--page-bg-color['"]\);[\s\S]*?}/,
      `${context}: viewer must apply page background variables before PDF.js finishes loading.`,
    );
    assert.match(
      viewerScriptSource,
      /captureViewState\(\)\s*{[\s\S]*?sidebarPanel: this\.activeSidebarPanel/,
      `${context}: view-state persistence must include the active sidebar panel.`,
    );
    assert.match(
      viewerScriptSource,
      /const THUMBNAIL_MAX_CANVASES = 8;/,
      `${context}: thumbnail rendering must keep a bounded live canvas pool.`,
    );
    assert.match(
      viewerScriptSource,
      /const THUMBNAIL_MAX_RENDER_JOBS = 3;/,
      `${context}: thumbnail rendering must bound in-flight PDF.js render tasks.`,
    );
    assert.match(
      viewerScriptSource,
      /await pagesInit;[\s\S]*?if \(!this\.isCurrentLoad\(token, pdfDocument\)\) {[\s\S]*?const outlinePopulated = await this\.populateOutline[\s\S]*?if \(!outlinePopulated \|\| !this\.isCurrentLoad\(token, pdfDocument\)\)/,
      `${context}: superseded loads must stop after async page/outline phases before mutating UI.`,
    );
    assert.match(
      viewerScriptSource,
      /flushPersistViewState\(\)\s*{[\s\S]*?vscode\.postMessage\({[\s\S]*?type: ['"]view-state['"][\s\S]*?state: this\.captureViewState\(\)/,
      `${context}: debounced view-state persistence must be flushable before webview teardown.`,
    );
    assert.match(
      viewerScriptSource,
      /cancelThumbnailJobs\(\)\s*{[\s\S]*?job\.renderTask\?\.cancel\?\.\(\)[\s\S]*?this\.thumbnailRenderJobs\.clear\(\)/,
      `${context}: thumbnail render tasks must be cancellable during reload/reset.`,
    );
    assert.match(
      viewerScriptSource,
      /removeQueuedThumbnail\(pageNumber\)[\s\S]*?shouldRenderQueuedThumbnail\(pageNumber\)/,
      `${context}: thumbnail queue must drop stale off-screen work before rendering.`,
    );
    assert.match(
      viewerScriptSource,
      /if \(this\.thumbnailRenderJobs\.get\(pageNumber\) === job\) {[\s\S]*?this\.thumbnailRenderJobs\.delete\(pageNumber\)/,
      `${context}: stale thumbnail render completions must not clear newer jobs.`,
    );
    assert.match(
      viewerScriptSource,
      /viewStatePersistenceSuspended[\s\S]*?flushPersistViewState\(\)[\s\S]*?this\.viewStatePersistenceSuspended \|\| !this\.pdfDocument/,
      `${context}: view-state writes must be suspended while a refreshed document is hydrating.`,
    );
    assert.match(
      viewerScriptSource,
      /acceptedPdfDocument[\s\S]*?loadingPdfDocument/,
      `${context}: reload rollback must distinguish accepted documents from in-flight candidates.`,
    );
    assert.match(
      viewerScriptSource,
      /if \(previousDocument && candidateDocument && !acceptedDocument\) {[\s\S]*?await this\.restorePreviousDocument\(previousDocument, viewState, token\)/,
      `${context}: failed replacement documents must restore the last accepted document.`,
    );
    assert.match(
      viewerScriptSource,
      /candidateDocument[\s\S]*?!acceptedDocument[\s\S]*?candidateDocument !== this\.pdfDocument[\s\S]*?await candidateDocument\.destroy\(\)/,
      `${context}: rejected replacement documents must be destroyed after rollback.`,
    );
    assert.match(
      viewerScriptSource,
      /new IntersectionObserver\([\s\S]*?root: this\.elements\.thumbnailPanel/,
      `${context}: thumbnail rendering must be driven by sidebar visibility, not all pages at once.`,
    );
    assert.match(
      viewerScriptSource,
      /populateThumbnails\(pdfDocument, token\)\s*{[\s\S]*?pageNumber <= pdfDocument\.numPages[\s\S]*?this\.createThumbnailItem\(pageNumber\)/,
      `${context}: thumbnail setup must create one navigation item per PDF page.`,
    );
    assert.match(
      viewerScriptSource,
      /createThumbnailItem\(pageNumber\)\s*{[\s\S]*?addEventListener\('click'[\s\S]*?this\.pdfViewer\.currentPageNumber = pageNumber/s,
      `${context}: clicking a thumbnail must navigate the PDF viewer to that page.`,
    );
    assert.match(
      viewerScriptSource,
      /handleThumbnailKeydown\(event\)\s*{[\s\S]*?event\.key === 'ArrowUp'[\s\S]*?event\.key === 'ArrowDown'[\s\S]*?event\.key === 'Enter'[\s\S]*?currentItem\.click\(\)/,
      `${context}: thumbnail keyboard navigation must handle up/down focus and enter activation.`,
    );
    assert.match(
      viewerScriptSource,
      /class TidyPDFViewer extends PDFViewer \{[\s\S]*?_resetView\(\)[\s\S]*?pageView\.destroy\(\)[\s\S]*?super\._resetView\(\)/,
      `${context}: page views must free their canvases on reset; PDF.js only drops the references, and this extension reloads on every rebuild.`,
    );
    assert.match(
      viewerScriptSource,
      /this\.pdfViewer = new TidyPDFViewer\(\{/,
      `${context}: the viewer must be the canvas-freeing subclass, not PDFViewer itself.`,
    );
  }
}
