import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { Disposable } from './disposable';
import { printPdf } from './print';
import {
  parseViewerToHostMessage,
  persistedViewStateOrUndefined,
  viewStateKey,
  type HostToViewerMessage,
  type ViewerEvent,
} from './webviewContract';

function createNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

const DEFAULT_RELOAD_DEBOUNCE_MS = 800;
const MAX_RELOAD_DELAY_MS = 5000;
const UNC_POLL_INTERVAL_MS = 2000;

// A PDF ends with the %%EOF marker, which the spec puts within the last 1024
// bytes. A build rewrites the file over hundreds of milliseconds and the
// watcher fires the moment it starts, so without this we hand the viewer a
// truncated document, it fails to parse, and the reader gets an error banner
// on the way to a perfectly good PDF. The debounce makes that less likely;
// looking for the trailer makes it decidable.
const PDF_TRAILER = Buffer.from('%%EOF', 'latin1');
const PDF_TRAILER_WINDOW = 1024;
const INCOMPLETE_READ_RETRY_MS = 120;
const INCOMPLETE_READ_BUDGET_MS = 2000;

export function pdfLooksComplete(data: Uint8Array): boolean {
  if (data.byteLength < PDF_TRAILER.byteLength) {
    return false;
  }
  const from = Math.max(0, data.byteLength - PDF_TRAILER_WINDOW);
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    .subarray(from)
    .includes(PDF_TRAILER);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizedReloadDebounceMs(value: unknown): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_RELOAD_DEBOUNCE_MS;
  }
  return Math.min(Math.max(Math.trunc(Number(value)), 0), 10_000);
}

function readReloadDebounceMs(): number {
  return normalizedReloadDebounceMs(
    vscode.workspace
      .getConfiguration('pdf-preview')
      .get<number>('reload.debounceMs', DEFAULT_RELOAD_DEBOUNCE_MS),
  );
}

function readAutomaticReload(resource?: vscode.Uri): boolean {
  return vscode.workspace
    .getConfiguration('pdf-preview', resource)
    .get<boolean>('reload.automatic', true);
}

export interface PdfPreviewHtmlOptions {
  csp: string;
  nonce: string;
  config: unknown;
  pdfViewerStylesUri: string;
  viewerStylesUri: string;
  mainScriptUri: string;
}

export const PDF_VIEWER_BODY = `<body>
  <svg style="display: none;">
    <symbol id="icon-chevron-left" viewBox="0 0 16 16" fill="none">
      <path d="M10 12L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="icon-chevron-right" viewBox="0 0 16 16" fill="none">
      <path d="M6 12L10 8L6 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="icon-zoom-out" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" stroke-width="1.5"/>
      <path d="M10.2 10.2L13.2 13.2M5.25 7H8.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </symbol>
    <symbol id="icon-zoom-in" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" stroke-width="1.5"/>
      <path d="M10.2 10.2L13.2 13.2M5.25 7H8.75M7 5.25V8.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </symbol>
    <symbol id="icon-search" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="4" stroke="currentColor" stroke-width="1.5"/>
      <path d="M10 10L13 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </symbol>
    <symbol id="icon-chevron-up" viewBox="0 0 16 16" fill="none">
      <path d="M4 10L8 6L12 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="icon-chevron-down" viewBox="0 0 16 16" fill="none">
      <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="icon-list-tree" viewBox="0 0 16 16" fill="none">
      <path d="M2.5 3.5H13.5M5.5 8H13.5M8.5 12.5H13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M3.25 6.5V8H4.75M6.25 11V12.5H7.75" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="icon-printer" viewBox="0 0 16 16" fill="none">
      <path d="M3 6H13C13.55 6 14 6.45 14 7V11C14 11.55 13.55 12 13 12H3C2.45 12 2 11.55 2 11V7C2 6.45 2.45 6 3 6Z" stroke="currentColor" stroke-width="1.5"/>
      <path d="M4 6V4C4 3.45 4.45 3 5 3H11C11.55 3 12 3.45 12 4V6" stroke="currentColor" stroke-width="1.5"/>
      <path d="M4 12V14C4 14.55 4.45 15 5 15H11C11.55 15 12 14.55 12 14V12" stroke="currentColor" stroke-width="1.5"/>
    </symbol>
    <symbol id="icon-refresh" viewBox="0 0 16 16" fill="none">
      <path d="M13 8A5 5 0 1 0 8 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M13 8V5M13 8H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="icon-auto-refresh" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.25" stroke="currentColor" stroke-width="1.5"/>
      <path d="M8 5V8L9.9 9.9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="icon-external-link" viewBox="0 0 16 16" fill="none">
      <path d="M6 4H4C3.45 4 3 4.45 3 5V12C3 12.55 3.45 13 4 13H11C11.55 13 12 12.55 12 12V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M9 3H13V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M8 8L13 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </symbol>
    <symbol id="icon-theme" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="4.5" stroke="currentColor" stroke-width="1.5"/>
      <path d="M8 3.5A4.5 4.5 0 0 0 8 12.5V3.5Z" fill="currentColor"/>
    </symbol>
  </svg>
  <div id="pdf-root">
    <header id="pdf-toolbar" role="toolbar" aria-label="PDF controls">
      <div class="toolbar-group">
        <button id="previous" class="icon-button" type="button" title="Previous page" aria-label="Previous page">
          <svg class="icon" width="16" height="16"><use href="#icon-chevron-left"/></svg>
          <span class="label">Prev</span>
        </button>
        <button id="next" class="icon-button" type="button" title="Next page" aria-label="Next page">
          <svg class="icon" width="16" height="16"><use href="#icon-chevron-right"/></svg>
          <span class="label">Next</span>
        </button>
        <input id="pageNumber" type="number" min="1" value="1" title="Page" aria-label="Page number">
        <span id="numPages">of —</span>
      </div>
      <div class="toolbar-group">
        <button id="zoomOut" class="icon-button" type="button" title="Zoom out" aria-label="Zoom out">
          <svg class="icon" width="16" height="16"><use href="#icon-zoom-out"/></svg>
        </button>
        <select id="scaleSelect" title="Zoom" aria-label="Zoom">
          <option value="auto">Auto</option>
          <option value="page-actual">Actual</option>
          <option value="page-fit">Fit</option>
          <option value="page-width">Width</option>
          <option value="0.5">50%</option>
          <option value="0.75">75%</option>
          <option value="1">100%</option>
          <option value="1.25">125%</option>
          <option value="1.5">150%</option>
          <option value="2">200%</option>
          <option value="3">300%</option>
          <option value="4">400%</option>
        </select>
        <button id="zoomIn" class="icon-button" type="button" title="Zoom in" aria-label="Zoom in">
          <svg class="icon" width="16" height="16"><use href="#icon-zoom-in"/></svg>
        </button>
      </div>
      <div class="toolbar-group toolbar-find">
        <input id="findInput" type="search" placeholder="Find" title="Find in document" aria-label="Find in document">
        <button id="findPrevious" class="icon-button" type="button" title="Previous match" aria-label="Previous match">
          <svg class="icon" width="16" height="16"><use href="#icon-chevron-up"/></svg>
          <span class="label">Prev</span>
        </button>
        <button id="findNext" class="icon-button" type="button" title="Next match" aria-label="Next match">
          <svg class="icon" width="16" height="16"><use href="#icon-chevron-down"/></svg>
          <span class="label">Next</span>
        </button>
        <span id="findStatus" aria-live="polite"></span>
      </div>
      <div class="toolbar-group toolbar-spacer"></div>
      <div class="toolbar-group">
        <button id="themeToggle" class="icon-button" type="button" title="Switch PDF page mode to Night" aria-label="Switch PDF page mode to Night" aria-pressed="false">
          <svg class="icon" width="16" height="16"><use href="#icon-theme"/></svg>
          <span class="label">Clear</span>
        </button>
        <button id="outlineToggle" class="icon-button" type="button" title="Toggle document outline" aria-label="Toggle document outline" disabled>
          <svg class="icon" width="16" height="16"><use href="#icon-list-tree"/></svg>
          <span class="label">Outline</span>
        </button>
        <button id="print" class="icon-button" type="button" title="Open in system viewer for printing" aria-label="Open in system viewer for printing">
          <svg class="icon" width="16" height="16"><use href="#icon-printer"/></svg>
          <span class="label">Print</span>
        </button>
        <button id="reload" class="icon-button" type="button" title="Refresh PDF" aria-label="Refresh PDF">
          <svg class="icon" width="16" height="16"><use href="#icon-refresh"/></svg>
          <span class="label">Refresh</span>
        </button>
        <button id="autoReloadToggle" class="icon-button" type="button" title="Disable automatic reload" aria-label="Disable automatic reload" aria-pressed="true">
          <svg class="icon" width="16" height="16"><use href="#icon-auto-refresh"/></svg>
          <span class="label">Auto</span>
        </button>
        <button id="openSource" class="icon-button" type="button" title="Open PDF with system viewer" aria-label="Open PDF with system viewer">
          <svg class="icon" width="16" height="16"><use href="#icon-external-link"/></svg>
          <span class="label">External</span>
        </button>
      </div>
    </header>
    <div id="pdf-content">
      <aside id="outlineSidebar" class="outline-sidebar hidden" aria-label="Document sidebar">
        <div class="sidebar-tabs" role="tablist" aria-label="Sidebar panels">
          <button id="outlinePanelTab" class="sidebar-tab is-active" type="button" role="tab" aria-selected="true" aria-controls="outlinePanel">Outline</button>
          <button id="thumbnailPanelTab" class="sidebar-tab" type="button" role="tab" aria-selected="false" aria-controls="thumbnailPanel">Thumbnails</button>
        </div>
        <section id="outlinePanel" class="sidebar-panel outline-panel" role="tabpanel" aria-labelledby="outlinePanelTab" aria-label="Document outline">
          <div class="sidebar-header outline-header">Outline</div>
          <div id="outlineTree" class="outline-tree"></div>
        </section>
        <section id="thumbnailPanel" class="sidebar-panel thumbnail-panel hidden" role="tabpanel" aria-labelledby="thumbnailPanelTab" aria-label="Page thumbnails" hidden>
          <div class="sidebar-header">Thumbnails</div>
          <div id="thumbnailList" class="thumbnail-list" aria-label="Page thumbnails"></div>
        </section>
      </aside>
      <div class="viewer-region">
        <div id="viewerContainer" role="main" tabindex="0">
          <div id="viewer" class="pdfViewer"></div>
        </div>
        <span id="status" role="status" aria-live="polite"></span>
      </div>
    </div>
    <div id="passwordOverlay" class="overlay hidden" role="dialog" aria-modal="true" aria-labelledby="passwordTitle">
      <form id="passwordForm" class="password-panel">
        <h1 id="passwordTitle">Password required</h1>
        <p id="passwordMessage">Enter the password to open this PDF.</p>
        <input id="passwordInput" type="password" autocomplete="current-password">
        <div class="password-actions">
          <button id="passwordCancel" type="button">Cancel</button>
          <button type="submit">Open</button>
        </div>
      </form>
    </div>
  </div>
</body>`;

function htmlAttributeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function renderPdfPreviewHtml({
  csp,
  nonce,
  config,
  pdfViewerStylesUri,
  viewerStylesUri,
  mainScriptUri,
}: PdfPreviewHtmlOptions): string {
  const head = `<!DOCTYPE html>
<html dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="google" content="notranslate">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta id="pdf-preview-config" data-config="${htmlAttributeJson(config)}">
<title>PDF Preview Next</title>
<link rel="stylesheet" href="${pdfViewerStylesUri}">
<link rel="stylesheet" href="${viewerStylesUri}">
<script nonce="${nonce}">
(() => {
  let startupError = '';
  const applyStartupError = () => {
    if (!startupError) {
      return;
    }
    const status = document.getElementById('status');
    if (!status) {
      return;
    }
    status.textContent = startupError;
    status.title = startupError;
    status.classList.add('is-visible');
  };
  const messageFromReason = (reason) =>
    reason && typeof reason === 'object' && 'message' in reason
      ? reason.message
      : String(reason);
  const showStartupError = (reason) => {
    startupError = 'Could not start PDF viewer: ' + messageFromReason(reason);
    applyStartupError();
    console.error('PDF Preview: startup error', reason);
  };
  window.addEventListener('error', (event) => {
    showStartupError(event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    showStartupError(event.reason);
  });
  window.addEventListener('DOMContentLoaded', applyStartupError, { once: true });
})();
</script>
<script nonce="${nonce}" type="module" src="${mainScriptUri}"></script>
</head>`;

  return head + PDF_VIEWER_BODY + '</html>';
}

export function webviewLocalResourceRoots(
  extensionRoot: vscode.Uri,
): vscode.Uri[] {
  // Document bytes arrive over postMessage, so the webview only ever loads
  // resources from the extension itself. Keeping the PDF's directory out of
  // the roots both tightens the sandbox and avoids webview boot failures for
  // locations the renderer cannot serve (UNC/WSL shares).
  return [extensionRoot];
}

export async function clearPdfPreviewViewState(
  workspaceState: vscode.Memento,
  resource: vscode.Uri,
): Promise<void> {
  await workspaceState.update(viewStateKey(resource), undefined);
}

export function resolvePdfLinkTarget(
  resource: vscode.Uri,
  href: string,
): vscode.Uri | undefined {
  if (resource.scheme !== 'file') {
    return undefined;
  }

  const trimmedHref = href.trim();
  if (
    !trimmedHref ||
    trimmedHref.startsWith('#') ||
    trimmedHref.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmedHref)
  ) {
    return undefined;
  }

  const hashIndex = trimmedHref.indexOf('#');
  const pathAndQuery =
    hashIndex >= 0 ? trimmedHref.slice(0, hashIndex) : trimmedHref;
  const fragment = hashIndex >= 0 ? trimmedHref.slice(hashIndex + 1) : '';
  const queryIndex = pathAndQuery.indexOf('?');
  const rawPath =
    queryIndex >= 0 ? pathAndQuery.slice(0, queryIndex) : pathAndQuery;
  const query = queryIndex >= 0 ? pathAndQuery.slice(queryIndex + 1) : '';

  if (!rawPath.toLowerCase().endsWith('.pdf')) {
    return undefined;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return undefined;
  }

  if (decodedPath.startsWith('/') || path.isAbsolute(decodedPath)) {
    return undefined;
  }

  const currentDir = path.dirname(resource.fsPath);
  const targetPath = path.resolve(currentDir, decodedPath);
  const relativePath = path.relative(currentDir, targetPath);
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return undefined;
  }

  return vscode.Uri.file(targetPath).with({ fragment, query });
}

export class PdfPreview extends Disposable {
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;
  private reloadBurstStartedAt: number | undefined;
  private reloadDebounceMs = readReloadDebounceMs();
  private automaticReload: boolean;

  constructor(
    private readonly extensionRoot: vscode.Uri,
    private readonly resource: vscode.Uri,
    private readonly webviewEditor: vscode.WebviewPanel,
    private readonly workspaceState: vscode.Memento,
    private readonly onViewerEvent: (event: ViewerEvent) => void = () => {},
    private readonly log: (line: string) => void = () => {},
  ) {
    super();
    const config = vscode.workspace.getConfiguration('pdf-preview');
    const closeOnDelete = config.get<boolean>('reload.closeOnDelete', false);
    this.automaticReload = readAutomaticReload(this.resource);

    webviewEditor.webview.options = {
      enableScripts: true,
      localResourceRoots: webviewLocalResourceRoots(extensionRoot),
    };

    this._register(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('pdf-preview.reload.debounceMs')) {
          this.reloadDebounceMs = readReloadDebounceMs();
        }
        if (event.affectsConfiguration('pdf-preview.reload.automatic')) {
          this.automaticReload = readAutomaticReload(this.resource);
          const message: HostToViewerMessage = {
            type: 'auto-reload-state',
            enabled: this.automaticReload,
          };
          void this.webviewEditor.webview.postMessage(message);
        }
        if (event.affectsConfiguration('pdf-preview.copy.autoCopySelection')) {
          const message: HostToViewerMessage = {
            type: 'copy-auto-selection-state',
            enabled: vscode.workspace
              .getConfiguration('pdf-preview', this.resource)
              .get<boolean>('copy.autoCopySelection', false),
          };
          void this.webviewEditor.webview.postMessage(message);
        }
      }),
    );

    this._register(
      webviewEditor.webview.onDidReceiveMessage((message: unknown) => {
        const parsedMessage = parseViewerToHostMessage(message);
        if (!parsedMessage) {
          return;
        }

        switch (parsedMessage.type) {
          case 'open-source':
            void this.openSource();
            break;
          case 'open-external':
            void this.openExternal();
            break;
          case 'print-request':
            void printPdf(this.resource);
            break;
          case 'request-document':
            void this.sendDocumentData(parsedMessage.requestId);
            break;
          case 'set-auto-reload': {
            const target = vscode.workspace.workspaceFolders?.length
              ? vscode.ConfigurationTarget.Workspace
              : vscode.ConfigurationTarget.Global;
            void vscode.workspace
              .getConfiguration('pdf-preview', this.resource)
              .update('reload.automatic', parsedMessage.enabled, target);
            break;
          }
          case 'copy-text':
            void vscode.env.clipboard.writeText(parsedMessage.text);
            break;
          case 'open-pdf-link':
            void this.openPdfLink(parsedMessage.href);
            break;
          case 'appearance-theme':
            void vscode.workspace
              .getConfiguration('pdf-preview')
              .update(
                'appearance.theme',
                parsedMessage.theme,
                vscode.ConfigurationTarget.Global,
              );
            break;
          case 'viewer-ready':
          case 'viewer-error':
            this.onViewerEvent({
              ...parsedMessage,
              resource: this.resource.toString(),
            });
            break;
          case 'view-state':
            void this.workspaceState.update(
              viewStateKey(this.resource),
              parsedMessage.state,
            );
            break;
        }
      }),
    );

    const watcher = this._register(
      vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
          vscode.Uri.joinPath(resource, '..'),
          path.basename(resource.fsPath),
        ),
      ),
    );
    this._register(
      watcher.onDidChange(() => {
        if (this.automaticReload) {
          this.scheduleReload();
        }
      }),
    );
    this._register(
      watcher.onDidCreate(() => {
        if (this.automaticReload) {
          this.scheduleReload();
        }
      }),
    );
    this._register(
      watcher.onDidDelete(() => {
        this.handleFileDeleted(closeOnDelete);
      }),
    );
    this._register({ dispose: () => this.clearReloadTimer() });

    // VS Code's file watchers cannot watch UNC shares such as WSL's
    // \\wsl.localhost (they fail with EISDIR/EUNKNOWN), which would silently
    // break live reload for TeX/Typst builds running inside WSL. Poll the
    // file's metadata as a fallback whenever the resource has a UNC
    // authority.
    if (resource.scheme === 'file' && resource.authority) {
      this.startPollingWatcher(closeOnDelete);
    }

    this.webviewEditor.webview.html = this.getWebviewContents();
  }

  public get resourceUri(): vscode.Uri {
    return this.resource;
  }

  public async openSource(): Promise<void> {
    await this.openExternal();
  }

  /// Read the file, and wait out a build that is still writing it.
  ///
  /// The watcher fires when the write *starts*, so the first read during a
  /// rebuild often lands on a half-written PDF. Rather than shipping it and
  /// letting the viewer fail, re-read until the trailer is there or the budget
  /// runs out. Past the budget the bytes go through anyway: a file that never
  /// grows a %%EOF is genuinely broken, and the viewer's error is the honest
  /// answer for it.
  private async readWhenComplete(
    requestId: number,
    startedAt: number,
  ): Promise<Uint8Array> {
    const uri = this.resource.with({ fragment: '', query: '' });
    for (;;) {
      const data = await vscode.workspace.fs.readFile(uri);
      if (pdfLooksComplete(data) || this.isDisposed) {
        return data;
      }
      if (Date.now() - startedAt >= INCOMPLETE_READ_BUDGET_MS) {
        this.log(
          `[read] #${requestId} still truncated after ${Date.now() - startedAt}ms; sending anyway`,
        );
        return data;
      }
      this.log(`[read] #${requestId} truncated (${data.byteLength} bytes), waiting`);
      await delay(INCOMPLETE_READ_RETRY_MS);
    }
  }

  private async sendDocumentData(requestId: number): Promise<void> {
    const startedAt = Date.now();
    this.log(`[read] #${requestId} ${this.resource.toString()}`);
    try {
      const data = await this.readWhenComplete(requestId, startedAt);
      this.log(
        `[read] #${requestId} ${data.byteLength} bytes in ${Date.now() - startedAt}ms`,
      );
      if (this.isDisposed) {
        return;
      }
      const message: HostToViewerMessage = {
        type: 'document-data',
        requestId,
        // workspace.fs.readFile returns a Node Buffer, which the webview
        // message serializer JSON-ifies into {type:'Buffer',data:[...]}; a
        // plain Uint8Array takes VS Code's binary fast path instead.
        data: new Uint8Array(
          data.buffer,
          data.byteOffset,
          data.byteLength,
        ).slice(),
      };
      await this.webviewEditor.webview.postMessage(message);
      this.log(
        `[read] #${requestId} delivered after ${Date.now() - startedAt}ms`,
      );
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.log(`[read] #${requestId} failed: ${errorText}`);
      if (this.isDisposed) {
        return;
      }
      const message: HostToViewerMessage = {
        type: 'document-error',
        requestId,
        message: errorText,
      };
      await this.webviewEditor.webview.postMessage(message);
    }
  }

  public async openExternal(): Promise<void> {
    const openTarget =
      this.resource.scheme === 'file'
        ? vscode.Uri.file(this.resource.fsPath)
        : this.resource.with({ fragment: '', query: '' });
    await vscode.env.openExternal(openTarget);
  }

  public async openPdfLink(href: string): Promise<void> {
    const target = resolvePdfLinkTarget(this.resource, href);
    if (!target) {
      await vscode.window.showWarningMessage(
        'Only relative local PDF links are supported.',
      );
      return;
    }

    await vscode.commands.executeCommand(
      'vscode.openWith',
      target,
      'pdf-preview-next.preview',
    );
  }

  public refresh(): void {
    if (!this.isDisposed) {
      const message: HostToViewerMessage = { type: 'reload' };
      this.webviewEditor.webview.postMessage(message);
    }
  }

  public async resetViewState(): Promise<void> {
    await clearPdfPreviewViewState(this.workspaceState, this.resource);
    if (!this.isDisposed) {
      const message: HostToViewerMessage = { type: 'reset-view-state' };
      await this.webviewEditor.webview.postMessage(message);
    }
  }

  private handleFileDeleted(closeOnDelete: boolean): void {
    this.clearReloadTimer();
    if (closeOnDelete) {
      this.webviewEditor.dispose();
      return;
    }

    const webviewMessage: HostToViewerMessage = { type: 'file-deleted' };
    void this.webviewEditor.webview.postMessage(webviewMessage);
  }

  private startPollingWatcher(closeOnDelete: boolean): void {
    let lastStat: { mtime: number; size: number } | 'missing' | undefined;
    let checking = false;
    const poll = async (): Promise<void> => {
      if (checking || this.isDisposed) {
        return;
      }
      checking = true;
      try {
        const stat = await vscode.workspace.fs.stat(this.resource);
        const current = { mtime: stat.mtime, size: stat.size };
        if (lastStat === 'missing' || lastStat === undefined) {
          // First observation, or the file reappeared after deletion.
          const reappeared = lastStat === 'missing';
          lastStat = current;
          if (reappeared && this.automaticReload) {
            this.scheduleReload();
          }
        } else if (
          lastStat.mtime !== current.mtime ||
          lastStat.size !== current.size
        ) {
          lastStat = current;
          if (this.automaticReload) {
            this.scheduleReload();
          }
        }
      } catch {
        if (lastStat !== 'missing' && lastStat !== undefined) {
          lastStat = 'missing';
          this.handleFileDeleted(closeOnDelete);
        }
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(() => {
      void poll();
    }, UNC_POLL_INTERVAL_MS);
    this._register({ dispose: () => clearInterval(timer) });
    void poll();
  }

  private scheduleReload(): void {
    const now = Date.now();
    this.reloadBurstStartedAt ??= now;
    const elapsedMs = now - this.reloadBurstStartedAt;
    const delayMs =
      elapsedMs >= MAX_RELOAD_DELAY_MS
        ? 0
        : Math.min(this.reloadDebounceMs, MAX_RELOAD_DELAY_MS - elapsedMs);

    this.clearReloadTimer(false);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = undefined;
      this.reloadBurstStartedAt = undefined;
      this.refresh();
    }, delayMs);
  }

  private clearReloadTimer(resetBurst = true): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = undefined;
    }
    if (resetBurst) {
      this.reloadBurstStartedAt = undefined;
    }
  }

  private getWebviewContents(): string {
    const webview = this.webviewEditor.webview;
    const docPath = webview.asWebviewUri(this.resource);
    const cspSource = webview.cspSource;
    const nonce = createNonce();

    const resolve = (...parts: string[]): string =>
      webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionRoot, ...parts))
        .toString();
    const resolveDir = (...parts: string[]): string => `${resolve(...parts)}/`;

    const pdfjsDir = ['lib', 'pdfjs'];

    const pdfConfig = vscode.workspace.getConfiguration(
      'pdf-preview',
      this.resource,
    );
    const settings = {
      cMapUrl: resolveDir(...pdfjsDir, 'cmaps'),
      iccUrl: resolveDir(...pdfjsDir, 'iccs'),
      imageResourcesPath: resolveDir(...pdfjsDir, 'web', 'images'),
      hash: this.resource.fragment,
      path: docPath.toString(),
      standardFontDataUrl: resolveDir(...pdfjsDir, 'standard_fonts'),
      wasmUrl: resolveDir(...pdfjsDir, 'wasm'),
      workerSrc: resolve('lib', 'pdf.worker-wrapper.mjs'),
      polyfillsUrl: resolve('lib', 'polyfills.mjs'),
      workerBundleUrl: resolve(...pdfjsDir, 'build', 'pdf.worker.min.mjs'),
      defaults: {
        cursor: pdfConfig.get<string>('default.cursor'),
        scale: pdfConfig.get<string>('default.scale'),
        sidebar: pdfConfig.get<boolean>('default.sidebar'),
        sidebarPanel: pdfConfig.get<string>('default.sidebarPanel'),
        scrollMode: pdfConfig.get<string>('default.scrollMode'),
        spreadMode: pdfConfig.get<string>('default.spreadMode'),
      },
      appearance: {
        pageGap: pdfConfig.get<string>('appearance.pageGap'),
        theme: pdfConfig.get<string>('appearance.theme'),
      },
      reload: {
        debounceMs: this.reloadDebounceMs,
        automatic: this.automaticReload,
      },
      copy: {
        autoCopySelection: pdfConfig.get<boolean>(
          'copy.autoCopySelection',
          false,
        ),
      },
      initialViewState: persistedViewStateOrUndefined(
        this.workspaceState.get(viewStateKey(this.resource)),
      ),
    };

    const csp = [
      "default-src 'none'",
      `connect-src ${cspSource}`,
      `font-src ${cspSource}`,
      `img-src blob: data: ${cspSource}`,
      `script-src 'nonce-${nonce}' ${cspSource}`,
      `style-src 'unsafe-inline' ${cspSource}`,
      `worker-src ${cspSource} blob:`,
    ].join('; ');

    return renderPdfPreviewHtml({
      csp,
      nonce,
      config: settings,
      pdfViewerStylesUri: resolve(...pdfjsDir, 'web', 'pdf_viewer.css'),
      viewerStylesUri: resolve('lib', 'pdf.css'),
      mainScriptUri: resolve('lib', 'main.mjs'),
    });
  }
}
