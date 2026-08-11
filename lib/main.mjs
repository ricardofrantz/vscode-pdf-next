import './polyfills.mjs';
import * as pdfjsLib from './pdfjs/build/pdf.min.mjs';

// pdf_viewer.mjs resolves the core library through this global. Never assign
// globalThis.pdfjsWorker here: PDF.js treats a main-thread worker module as a
// signal to skip real Worker creation and run parsing on the UI thread. With
// workerSrc set, PDF.js spawns a real worker and only falls back to the
// main-thread path (via lazy dynamic import) if Worker creation fails.
globalThis.pdfjsLib = pdfjsLib;

const { getDocument, GlobalWorkerOptions, PasswordResponses } = pdfjsLib;
const {
  EventBus,
  FindState,
  LinkTarget,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
  RenderingStates,
  ScrollMode,
  SpreadMode,
} = await import('./pdfjs/web/pdf_viewer.mjs');

const vscode = acquireVsCodeApi();
const NAMED_SCALE_VALUES = new Set([
  'auto',
  'page-actual',
  'page-fit',
  'page-width',
]);
const SCALE_SELECT_VALUES = new Set([
  ...NAMED_SCALE_VALUES,
  '0.5',
  '0.75',
  '1',
  '1.25',
  '1.5',
  '2',
  '3',
  '4',
]);
const THEME_VALUES = new Set([
  'auto',
  'light',
  'dark',
  'night',
  'reader',
  'dark-pages',
  'inverted',
]);
const CYCLE_THEME_VALUES = ['night', 'reader', 'inverted'];
const THEME_LABELS = new Map([
  ['auto', 'Clear'],
  ['light', 'Clear'],
  ['dark', 'Clear'],
  ['night', 'Night'],
  ['reader', 'Reader'],
  ['dark-pages', 'Night'],
  ['inverted', 'Invert'],
]);
const PAGE_GAP_VALUES = new Set(['compact', 'normal', 'wide']);
const SIDEBAR_PANEL_VALUES = new Set(['outline', 'thumbnails']);
const HOST_MESSAGE_TYPES = new Set([
  'auto-reload-state',
  'copy-auto-selection-state',
  'document-data',
  'document-error',
  'file-deleted',
  'reload',
  'reset-view-state',
]);
const DOCUMENT_REQUEST_TIMEOUT_MS = 60_000;
const COPY_TEXT_MAX_LENGTH = 1_000_000;
const DEFAULT_RELOAD_DEBOUNCE_MS = 800;
const VIEW_STATE_PERSIST_DEBOUNCE_MS = 1000;
const FIND_HIGHLIGHT_ALL_MIN_QUERY_LENGTH = 3;
const FIND_HIGHLIGHT_ALL_MAX_PAGES = 50;
const THUMBNAIL_CSS_WIDTH = 126;
const THUMBNAIL_DEVICE_PIXEL_RATIO_MAX = 2;
const THUMBNAIL_MAX_CANVASES = 8;
const THUMBNAIL_MAX_RENDER_JOBS = 3;

function element(id) {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing viewer element: ${id}`);
  }
  return node;
}

function loadConfig() {
  const elem = element('pdf-preview-config');
  const encoded = elem.getAttribute('data-config');
  if (!encoded) {
    throw new Error('Could not load PDF preview configuration.');
  }
  return JSON.parse(encoded);
}

function hashFromUrl(url) {
  try {
    return new URL(url).hash.replace(/^#/, '');
  } catch {
    const hashIndex = url.indexOf('#');
    return hashIndex >= 0 ? url.slice(hashIndex + 1) : '';
  }
}

function normalizeScale(value) {
  if (typeof value !== 'string') {
    return 'auto';
  }
  if (NAMED_SCALE_VALUES.has(value)) {
    return value;
  }
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return value;
  }
  return 'auto';
}

function classValue(value, allowedValues, fallback) {
  return typeof value === 'string' && allowedValues.has(value)
    ? value
    : fallback;
}

function normalizeAppearance(appearance = {}) {
  return {
    theme: classValue(appearance.theme, THEME_VALUES, 'auto'),
    pageGap: classValue(appearance.pageGap, PAGE_GAP_VALUES, 'normal'),
  };
}

function normalizeSidebarPanel(value) {
  return classValue(value, SIDEBAR_PANEL_VALUES, 'outline');
}

function sidebarPanelLabel(panel) {
  return panel === 'thumbnails' ? 'Thumbnails' : 'Outline';
}

function clearThemeForTheme(theme) {
  return theme === 'night' ||
    theme === 'reader' ||
    theme === 'dark-pages' ||
    theme === 'inverted'
    ? 'auto'
    : theme;
}

function pageColorsForTheme(theme) {
  if (theme === 'night' || theme === 'dark-pages') {
    return { background: '#1b1b1b', foreground: '#d6d1c4' };
  }
  if (theme === 'reader') {
    // Warm e-reader sepia: color-preserving comfort mode, distinct from
    // Night's dark rendering.
    return { background: '#f4ecd8', foreground: '#5b4636' };
  }
  return null;
}

function canonicalCycleTheme(theme) {
  return theme === 'dark-pages' ? 'night' : theme;
}

function nextCycleTheme(theme) {
  const cycleTheme = canonicalCycleTheme(theme);
  const index = CYCLE_THEME_VALUES.indexOf(cycleTheme);
  if (index < 0) {
    return 'night';
  }
  return CYCLE_THEME_VALUES[(index + 1) % CYCLE_THEME_VALUES.length];
}

function themeLabel(theme) {
  return THEME_LABELS.get(theme) || 'Clear';
}

function applyPageColorVariables(viewer, theme) {
  const pageColors = pageColorsForTheme(theme);
  if (pageColors?.background) {
    viewer.style.setProperty('--page-bg-color', pageColors.background);
  } else {
    viewer.style.removeProperty('--page-bg-color');
  }
}

function scrollMode(name) {
  switch (name) {
    case 'horizontal':
      return ScrollMode.HORIZONTAL;
    case 'wrapped':
      return ScrollMode.WRAPPED;
    default:
      return ScrollMode.VERTICAL;
  }
}

function spreadMode(name) {
  switch (name) {
    case 'odd':
      return SpreadMode.ODD;
    case 'even':
      return SpreadMode.EVEN;
    default:
      return SpreadMode.NONE;
  }
}

function messageFromError(error) {
  if (error && typeof error === 'object' && 'message' in error) {
    return error.message;
  }
  return String(error);
}

function reloadDebounceMs(config) {
  const value = Number(config.reload?.debounceMs ?? DEFAULT_RELOAD_DEBOUNCE_MS);
  if (!Number.isFinite(value)) {
    return DEFAULT_RELOAD_DEBOUNCE_MS;
  }
  return Math.min(Math.max(Math.trunc(value), 0), 10000);
}

function isInteractiveTarget(target) {
  return (
    target instanceof Element &&
    !!target.closest(
      'a, button, input, select, textarea, [contenteditable], .textLayer',
    )
  );
}

function isRelativePdfHref(href) {
  const trimmedHref = href.trim();
  if (
    !trimmedHref ||
    trimmedHref.startsWith('#') ||
    trimmedHref.startsWith('/') ||
    trimmedHref.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmedHref)
  ) {
    return false;
  }

  const pathAndQuery = trimmedHref.split('#', 1)[0];
  const pathPart = pathAndQuery.split('?', 1)[0];
  return pathPart.toLowerCase().endsWith('.pdf');
}

function selectedTextFromTextLayer() {
  const selection = window.getSelection();
  const text = selection?.toString().trim() || '';
  if (!selection || !text || selection.rangeCount === 0) {
    return '';
  }

  const range = selection.getRangeAt(0);
  const ancestor =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  return ancestor?.closest('.textLayer') ? text : '';
}

function shouldHandlePdfTextCopy() {
  const activeElement = document.activeElement;
  if (
    activeElement instanceof Element &&
    activeElement.matches('input, textarea, [contenteditable]')
  ) {
    return false;
  }

  const text = selectedTextFromTextLayer();
  return text && text.length <= COPY_TEXT_MAX_LENGTH ? text : '';
}

async function fetchModuleText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

// VS Code webviews serve extension resources through a service worker that
// dedicated workers cannot reach, so PDF.js's own worker bootstrap (a blob
// wrapper that imports the cross-origin worker URL) stalls and falls back to
// parsing PDFs on the UI thread. Build the worker in the page context
// instead: fetch the polyfills and the self-contained worker bundle as text,
// combine them into one blob module (no imports), and hand PDF.js the
// running worker via GlobalWorkerOptions.workerPort. Returns null on any
// failure, leaving PDF.js's regular workerSrc/fake-worker path as fallback.
async function createPdfWorker(config) {
  try {
    if (typeof Worker !== 'function' || !config.workerBundleUrl) {
      return null;
    }
    const [polyfillsText, workerText] = await Promise.all([
      fetchModuleText(config.polyfillsUrl),
      fetchModuleText(config.workerBundleUrl),
    ]);
    const blobUrl = URL.createObjectURL(
      new Blob([polyfillsText, '\n', workerText], {
        type: 'text/javascript',
      }),
    );
    return new Worker(blobUrl, { type: 'module', name: 'pdfjs-worker' });
  } catch (error) {
    console.warn(
      'PDF Preview: could not start the dedicated PDF.js worker; PDF.js will use its fallback path.',
      error,
    );
    return null;
  }
}

function isTrustedHostMessage(event) {
  return (
    event.origin === window.location.origin || event.source === window.parent
  );
}

function hostMessageFromEvent(event) {
  const message = event.data;
  if (
    !isTrustedHostMessage(event) ||
    !message ||
    typeof message !== 'object' ||
    typeof message.type !== 'string' ||
    !HOST_MESSAGE_TYPES.has(message.type)
  ) {
    return null;
  }
  return message;
}

class PdfPreviewApp {
  constructor() {
    this.config = loadConfig();
    this.elements = {
      container: element('viewerContainer'),
      findInput: element('findInput'),
      findNext: element('findNext'),
      findPrevious: element('findPrevious'),
      findStatus: element('findStatus'),
      next: element('next'),
      numPages: element('numPages'),
      openSource: element('openSource'),
      outlinePanel: element('outlinePanel'),
      outlinePanelTab: element('outlinePanelTab'),
      outlineSidebar: element('outlineSidebar'),
      outlineToggle: element('outlineToggle'),
      outlineTree: element('outlineTree'),
      thumbnailList: element('thumbnailList'),
      thumbnailPanel: element('thumbnailPanel'),
      thumbnailPanelTab: element('thumbnailPanelTab'),
      pageNumber: element('pageNumber'),
      passwordCancel: element('passwordCancel'),
      passwordForm: element('passwordForm'),
      passwordInput: element('passwordInput'),
      passwordMessage: element('passwordMessage'),
      passwordOverlay: element('passwordOverlay'),
      previous: element('previous'),
      print: element('print'),
      reload: element('reload'),
      autoReloadToggle: element('autoReloadToggle'),
      scaleSelect: element('scaleSelect'),
      status: element('status'),
      themeToggle: element('themeToggle'),
      viewer: element('viewer'),
      zoomIn: element('zoomIn'),
      zoomOut: element('zoomOut'),
    };
    this.eventBus = new EventBus();
    this.linkService = new PDFLinkService({
      eventBus: this.eventBus,
      externalLinkRel: 'noopener noreferrer nofollow',
      externalLinkTarget: LinkTarget.BLANK,
    });
    this.findController = new PDFFindController({
      eventBus: this.eventBus,
      linkService: this.linkService,
    });
    this.appearance = normalizeAppearance(this.config.appearance);
    this.automaticReload = this.config.reload?.automatic !== false;
    this.clearTheme = clearThemeForTheme(this.appearance.theme);
    this.pdfViewer = new PDFViewer({
      container: this.elements.container,
      eventBus: this.eventBus,
      findController: this.findController,
      imageResourcesPath: this.config.imageResourcesPath,
      linkService: this.linkService,
      pageColors: pageColorsForTheme(this.appearance.theme),
      viewer: this.elements.viewer,
    });
    this.linkService.setViewer(this.pdfViewer);

    this.activeSidebarPanel = normalizeSidebarPanel(
      this.config.defaults?.sidebarPanel,
    );
    this.loadingTask = null;
    this.loadToken = 0;
    this.pdfDocument = null;
    this.acceptedPdfDocument = null;
    this.loadingPdfDocument = null;
    this.pendingPasswordUpdate = null;
    this.findInputTimer = null;
    this.persistViewStateTimer = null;
    this.reloadRetryTimer = null;
    this.outlineVisibleOverride = null;
    this.thumbnailCanvases = new Map();
    this.thumbnailObserver = null;
    this.thumbnailRenderToken = 0;
    this.thumbnailRenderJobs = new Map();
    this.thumbnailRenderQueue = [];
    this.thumbnailUseCounter = 0;
    this.activeThumbnailPage = null;
    this.visibleThumbnailPages = new Set();
    this.lastUserInteractionAt = 0;
    this.viewStatePersistenceSuspended = false;
    this.documentRequestId = 0;
    this.pendingDocumentRequests = new Map();

    this.pendingTaskDestruction = null;
    GlobalWorkerOptions.workerSrc = this.config.workerSrc;
    this.applyAppearance();
    this.setupEvents();
    this.applyCursorDefault();
    this.updateFindButtons();
    this.updatePageControls();
    this.updateThemeToggle();
    this.updateAutoReloadToggle();
    this.setSidebarPanel(this.activeSidebarPanel);
  }

  setupEvents() {
    this.elements.openSource.addEventListener('click', () => {
      vscode.postMessage({ type: 'open-source' });
    });
    this.elements.outlineToggle.addEventListener('click', () => {
      this.setOutlineVisible(
        this.elements.outlineSidebar.classList.contains('hidden'),
        { remember: true },
      );
    });
    this.elements.outlinePanelTab.addEventListener('click', () => {
      this.setSidebarPanel('outline', { remember: true });
    });
    this.elements.thumbnailPanelTab.addEventListener('click', () => {
      this.setSidebarPanel('thumbnails', { remember: true });
    });
    window.addEventListener(
      'pointerdown',
      () => {
        this.lastUserInteractionAt = Date.now();
      },
      { capture: true },
    );
    window.addEventListener(
      'keydown',
      () => {
        this.lastUserInteractionAt = Date.now();
      },
      { capture: true },
    );
    window.addEventListener(
      'focusin',
      () => {
        this.lastUserInteractionAt = Date.now();
      },
      { capture: true },
    );
    this.elements.thumbnailList.addEventListener('keydown', (event) => {
      this.handleThumbnailKeydown(event);
    });
    this.elements.reload.addEventListener('click', () => {
      this.refreshDocument(true);
    });
    this.elements.autoReloadToggle.addEventListener('click', () => {
      vscode.postMessage({
        type: 'set-auto-reload',
        enabled: !this.automaticReload,
      });
    });
    this.elements.print.addEventListener('click', () => {
      vscode.postMessage({ type: 'print-request' });
    });
    this.elements.themeToggle.addEventListener('click', (event) => {
      this.cyclePageTheme({ clear: event.shiftKey || event.altKey });
    });
    this.elements.previous.addEventListener('click', () => {
      this.pdfViewer.currentPageNumber -= 1;
    });
    this.elements.next.addEventListener('click', () => {
      this.pdfViewer.currentPageNumber += 1;
    });
    this.elements.pageNumber.addEventListener('change', () => {
      this.goToPageFromInput();
    });
    this.elements.pageNumber.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        this.goToPageFromInput();
      }
    });
    this.elements.scaleSelect.addEventListener('change', () => {
      if (this.elements.scaleSelect.value === 'custom') {
        return;
      }
      this.pdfViewer.currentScaleValue = this.elements.scaleSelect.value;
    });
    this.elements.zoomIn.addEventListener('click', () => {
      this.pdfViewer.increaseScale();
    });
    this.elements.zoomOut.addEventListener('click', () => {
      this.pdfViewer.decreaseScale();
    });
    this.elements.findInput.addEventListener('input', () => {
      clearTimeout(this.findInputTimer);
      this.findInputTimer = setTimeout(() => this.dispatchFind(''), 250);
    });
    this.elements.findInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        clearTimeout(this.findInputTimer);
        const previousQuery = this.findController.state?.query;
        this.dispatchFind(
          this.elements.findInput.value === previousQuery ? 'again' : '',
          event.shiftKey,
        );
      }
    });
    this.elements.findNext.addEventListener('click', () => {
      this.dispatchFind('again', false);
    });
    this.elements.findPrevious.addEventListener('click', () => {
      this.dispatchFind('again', true);
    });
    this.elements.passwordForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitPassword();
    });
    this.elements.passwordCancel.addEventListener('click', () => {
      this.cancelPasswordPrompt();
    });
    this.elements.container.addEventListener('dragstart', (event) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest('.textLayer')
      ) {
        event.preventDefault();
      }
    });
    this.elements.container.addEventListener('click', (event) => {
      const link = event.target instanceof Element && event.target.closest('a');
      if (!link) {
        return;
      }
      const rawHref = link.getAttribute('href');
      if (rawHref && isRelativePdfHref(rawHref)) {
        event.preventDefault();
        this.flushPersistViewState();
        vscode.postMessage({ type: 'open-pdf-link', href: rawHref });
      }
    });
    document.addEventListener('mouseup', () => {
      if (!this.config.copy?.autoCopySelection) {
        return;
      }
      const text = shouldHandlePdfTextCopy();
      if (text) {
        vscode.postMessage({ type: 'copy-text', text });
      }
    });
    window.addEventListener('keydown', (event) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'r') {
        event.preventDefault();
        this.refreshDocument(true);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'f') {
        event.preventDefault();
        // The find group collapses in very narrow toolbars; reveal it first so
        // the shortcut cannot focus a hidden input.
        document.body.classList.add('find-open');
        this.elements.findInput.focus();
        this.elements.findInput.select();
        return;
      }
      if (key === 'escape' && document.body.classList.contains('find-open')) {
        document.body.classList.remove('find-open');
        this.elements.container.focus();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'c') {
        const text = shouldHandlePdfTextCopy();
        if (text) {
          event.preventDefault();
          vscode.postMessage({ type: 'copy-text', text });
        }
      }
    });
    this.elements.container.addEventListener('keydown', (event) => {
      this.handleViewerKeydown(event);
    });
    this.elements.container.addEventListener('scroll', () => {
      this.schedulePersistViewState();
    });
    window.addEventListener('message', (event) => {
      const message = hostMessageFromEvent(event);
      if (!message) {
        return;
      }
      if (
        message.type === 'document-data' ||
        message.type === 'document-error'
      ) {
        this.handleDocumentMessage(message);
      } else if (message.type === 'reload') {
        this.refreshDocument(false);
      } else if (message.type === 'reset-view-state') {
        this.resetViewState();
      } else if (message.type === 'file-deleted') {
        this.setStatus('PDF deleted. Waiting for it to be recreated.');
      } else if (
        message.type === 'auto-reload-state' &&
        typeof message.enabled === 'boolean'
      ) {
        this.setAutoReload(message.enabled);
      } else if (
        message.type === 'copy-auto-selection-state' &&
        typeof message.enabled === 'boolean'
      ) {
        this.setAutoCopySelection(message.enabled);
      }
    });
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.flushPersistViewState();
      }
    });
    window.addEventListener('pagehide', () => {
      this.flushPersistViewState();
    });

    this.eventBus.on('pagechanging', () => {
      this.updatePageControls();
      this.updateActiveThumbnail();
      this.schedulePersistViewState();
    });
    this.eventBus.on('pagesloaded', ({ pagesCount }) => {
      this.elements.numPages.textContent = pagesCount ? `of ${pagesCount}` : 'of —';
      this.updatePageControls();
    });
    this.eventBus.on('scalechanging', (event) => {
      this.updateScaleSelect(event.presetValue || String(event.scale));
      this.schedulePersistViewState();
    });
    this.eventBus.on('updatefindmatchescount', (event) => {
      this.updateFindStatus(event.matchesCount);
    });
    this.eventBus.on('updatefindcontrolstate', (event) => {
      this.updateFindControlState(event);
    });
  }

  // The document bytes come from the extension host over postMessage rather
  // than a webview-resource fetch: the webview's service worker cannot serve
  // some filesystems the extension host reads fine (UNC/WSL shares stall for
  // many seconds or indefinitely), and binary messages transfer efficiently.
  readDocumentData() {
    const requestId = ++this.documentRequestId;
    return new Promise((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        if (this.pendingDocumentRequests.delete(requestId)) {
          reject(new Error('Timed out reading the PDF from the host.'));
        }
      }, DOCUMENT_REQUEST_TIMEOUT_MS);
      this.pendingDocumentRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timeoutTimer);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeoutTimer);
          reject(error);
        },
      });
      vscode.postMessage({ type: 'request-document', requestId });
    });
  }

  handleDocumentMessage(message) {
    const pending = this.pendingDocumentRequests.get(message.requestId);
    if (!pending) {
      return;
    }
    this.pendingDocumentRequests.delete(message.requestId);
    if (message.type === 'document-error') {
      pending.reject(
        new Error(
          typeof message.message === 'string'
            ? message.message
            : 'Could not read PDF resource.',
        ),
      );
      return;
    }
    const data = message.data;
    if (data instanceof Uint8Array) {
      pending.resolve(data);
    } else if (data instanceof ArrayBuffer) {
      pending.resolve(new Uint8Array(data));
    } else if (ArrayBuffer.isView(data)) {
      pending.resolve(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      );
    } else {
      const shape = Object.prototype.toString.call(data);
      const keys =
        data && typeof data === 'object'
          ? Object.keys(data).slice(0, 5).join(',')
          : String(data);
      pending.reject(
        new Error(
          `Host sent PDF data in an unexpected format: ${shape} keys=${keys}`,
        ),
      );
    }
  }

  loadOptions(data) {
    return {
      cMapPacked: true,
      cMapUrl: this.config.cMapUrl,
      data,
      disableRange: true,
      disableStream: true,
      iccUrl: this.config.iccUrl,
      isImageDecoderSupported: false,
      standardFontDataUrl: this.config.standardFontDataUrl,
      useWasm: false,
      useWorkerFetch: false,
      wasmUrl: this.config.wasmUrl,
    };
  }

  async loadDocument({
    restoreView = false,
    retryOnFailure = false,
    userInitiated = false,
  } = {}) {
    this.clearReloadRetry();
    const loadStartedAt = performance.now();
    const previousActiveElement = document.activeElement?.id || null;
    const loadInteractionMarker = this.lastUserInteractionAt;
    const viewState = restoreView
      ? this.captureViewState()
      : this.initialViewState();
    const token = ++this.loadToken;

    if (this.loadingTask) {
      this.destroyLoadingTask();
    }
    if (this.pendingTaskDestruction) {
      // A PDFWorker attached to GlobalWorkerOptions.workerPort is shared
      // across documents; creating the next document while the previous
      // task is still tearing down throws in PDFWorker.fromPort.
      await this.pendingTaskDestruction;
      this.pendingTaskDestruction = null;
    }
    if (token !== this.loadToken) {
      return;
    }
    if (
      this.loadingPdfDocument &&
      this.loadingPdfDocument !== this.acceptedPdfDocument
    ) {
      void this.loadingPdfDocument.destroy().catch((error) => {
        console.warn(
          'PDF Preview: failed to destroy superseded document',
          error,
        );
      });
      this.loadingPdfDocument = null;
    }
    this.hidePasswordPrompt();
    this.setStatus('Reading PDF');
    let previousDocument = null;
    let candidateDocument = null;
    let acceptedDocument = false;

    try {
      const fetchStartedAt = performance.now();
      const pdfData = await this.readDocumentData();
      const fetchMs = Math.max(
        0,
        Math.round(performance.now() - fetchStartedAt),
      );
      if (token !== this.loadToken) {
        return;
      }

      this.setStatus('Loading');
      const loadingTask = getDocument(this.loadOptions(pdfData));
      this.loadingTask = loadingTask;
      loadingTask.onProgress = ({ loaded, total }) => {
        if (token !== this.loadToken || !total) {
          return;
        }
        const percent = Math.round((loaded / total) * 100);
        this.setStatus(`Loading ${percent}%`);
      };
      loadingTask.onPassword = (updatePassword, reason) => {
        if (token === this.loadToken) {
          this.showPasswordPrompt(updatePassword, reason);
        }
      };

      const pdfDocument = await loadingTask.promise;
      candidateDocument = pdfDocument;
      if (token !== this.loadToken) {
        await pdfDocument.destroy();
        return;
      }
      if (pdfDocument.numPages < 1) {
        await pdfDocument.destroy();
        candidateDocument = null;
        throw new Error('PDF has no pages.');
      }

      previousDocument = this.acceptedPdfDocument;
      this.resetThumbnails();
      this.viewStatePersistenceSuspended = true;
      const pagesInit = this.waitForEvent('pagesinit');
      this.linkService.setDocument(pdfDocument, this.config.path);
      this.pdfViewer.setDocument(pdfDocument);
      this.loadingPdfDocument = pdfDocument;
      await pagesInit;
      if (!this.isCurrentLoad(token, pdfDocument)) {
        return;
      }
      const outlinePopulated = await this.populateOutline(
        pdfDocument,
        token,
        viewState,
      );
      if (!outlinePopulated || !this.isCurrentLoad(token, pdfDocument)) {
        return;
      }
      this.populateThumbnails(pdfDocument, token);
      if (!this.isCurrentLoad(token, pdfDocument)) {
        return;
      }
      await this.applyDocumentView(viewState);
      if (!this.isCurrentLoad(token, pdfDocument)) {
        return;
      }
      this.updatePageControls();
      this.updateFindButtons();
      await this.waitForPageRendered(this.pdfViewer.currentPageNumber || 1, {
        rejectOnError: true,
      });
      if (!this.isCurrentLoad(token, pdfDocument)) {
        return;
      }
      this.pdfDocument = pdfDocument;
      this.acceptedPdfDocument = pdfDocument;
      this.loadingPdfDocument = null;
      this.viewStatePersistenceSuspended = false;
      acceptedDocument = true;
      if (previousDocument && previousDocument !== pdfDocument) {
        try {
          await previousDocument.destroy();
        } catch (error) {
          console.warn(
            'PDF Preview: failed to destroy previous document',
            error,
          );
        }
        previousDocument = null;
      }
      this.setStatus('');
      const workerPort = loadingTask._worker?.port;
      vscode.postMessage({
        type: 'viewer-ready',
        pagesCount: pdfDocument.numPages,
        pageNumber: this.pdfViewer.currentPageNumber || 1,
        workerType:
          typeof Worker !== 'undefined' && workerPort instanceof Worker
            ? 'worker'
            : 'fake',
        durationMs: Math.max(0, Math.round(performance.now() - loadStartedAt)),
        fetchMs,
      });
      if (
        userInitiated &&
        previousActiveElement &&
        this.lastUserInteractionAt === loadInteractionMarker
      ) {
        const element = document.getElementById(previousActiveElement);
        if (element && typeof element.focus === 'function') {
          element.focus();
        }
      }
    } catch (error) {
      if (token !== this.loadToken) {
        return;
      }
      if (previousDocument && candidateDocument && !acceptedDocument) {
        await this.restorePreviousDocument(previousDocument, viewState, token);
        previousDocument = null;
      } else if (candidateDocument && this.loadingPdfDocument === candidateDocument) {
        this.loadingPdfDocument = null;
        this.pdfDocument = null;
        this.acceptedPdfDocument = null;
        this.pdfViewer.setDocument(null);
        this.linkService.setDocument(null);
      } else if (!this.pdfDocument) {
        this.pdfViewer.setDocument(null);
        this.linkService.setDocument(null);
      }
      if (
        candidateDocument &&
        !acceptedDocument &&
        candidateDocument !== this.pdfDocument
      ) {
        try {
          await candidateDocument.destroy();
        } catch (destroyError) {
          console.warn(
            'PDF Preview: failed to destroy rejected document',
            destroyError,
          );
        }
        candidateDocument = null;
      }
      if (retryOnFailure && this.pdfDocument) {
        this.setStatus(
          `Could not refresh PDF: ${messageFromError(error)}. Keeping previous version and retrying once.`,
        );
        this.reloadRetryTimer = setTimeout(() => {
          this.reloadRetryTimer = null;
          this.loadDocument({ restoreView: true });
        }, reloadDebounceMs(this.config));
      } else {
        const message = messageFromError(error);
        this.setStatus(`Could not load PDF: ${message}`);
        vscode.postMessage({ type: 'viewer-error', message });
      }
      console.error('PDF Preview: failed to load document', error);
    } finally {
      if (token === this.loadToken) {
        this.loadingTask = null;
        this.viewStatePersistenceSuspended = false;
        if (acceptedDocument) {
          this.flushPersistViewState();
        }
      }
    }
  }

  async restorePreviousDocument(previousDocument, viewState, token) {
    this.resetThumbnails();
    this.viewStatePersistenceSuspended = true;
    const pagesInit = this.waitForEvent('pagesinit');
    this.linkService.setDocument(previousDocument, this.config.path);
    this.pdfViewer.setDocument(previousDocument);
    this.pdfDocument = previousDocument;
    this.acceptedPdfDocument = previousDocument;
    this.loadingPdfDocument = null;
    await pagesInit;
    if (!this.isCurrentLoad(token, previousDocument)) {
      return;
    }
    await this.populateOutline(previousDocument, token, viewState);
    if (!this.isCurrentLoad(token, previousDocument)) {
      return;
    }
    this.populateThumbnails(previousDocument, token);
    await this.applyDocumentView(viewState);
    if (!this.isCurrentLoad(token, previousDocument)) {
      return;
    }
    this.updatePageControls();
    this.updateFindButtons();
    this.viewStatePersistenceSuspended = false;
  }

  refreshDocument(userInitiated = false) {
    this.flushPersistViewState();
    this.loadDocument({
      restoreView: true,
      retryOnFailure: true,
      userInitiated,
    });
  }

  resetViewState() {
    clearTimeout(this.persistViewStateTimer);
    this.config.initialViewState = null;
    this.outlineVisibleOverride = null;
    this.loadDocument({
      restoreView: false,
      retryOnFailure: true,
      userInitiated: true,
    });
  }

  cyclePageTheme({ clear = false } = {}) {
    this.flushPersistViewState();
    // The cycle only walks the page reading modes; clearing back to plain
    // pages is the Shift/Alt+click escape hatch and the appearance setting.
    const nextTheme = clear
      ? this.clearTheme
      : nextCycleTheme(this.appearance.theme);
    this.appearance = {
      ...this.appearance,
      theme: nextTheme,
    };
    vscode.postMessage({
      type: 'appearance-theme',
      theme: this.appearance.theme,
    });
    this.applyAppearance();
    this.updateThemeToggle();
    if (
      !this.pdfDocument ||
      !this.applyPageColors(pageColorsForTheme(this.appearance.theme))
    ) {
      this.loadDocument({ restoreView: true, retryOnFailure: true });
    }
  }

  applyPageColors(pageColors) {
    this.pdfViewer.pageColors = pageColors;
    const pages = this.pdfViewer._pages;
    if (!Array.isArray(pages)) {
      return false;
    }
    for (const pageView of pages) {
      pageView.pageColors = pageColors;
    }
    this.pdfViewer.refresh();
    return true;
  }

  isCurrentLoad(token, pdfDocument = null) {
    return (
      token === this.loadToken &&
      (!pdfDocument ||
        pdfDocument === this.pdfDocument ||
        pdfDocument === this.loadingPdfDocument)
    );
  }

  clearReloadRetry() {
    if (this.reloadRetryTimer) {
      clearTimeout(this.reloadRetryTimer);
      this.reloadRetryTimer = null;
    }
  }

  waitForEvent(eventName) {
    return new Promise((resolve) => {
      this.eventBus.on(eventName, resolve, { once: true });
    });
  }

  initialViewState() {
    const documentHash = hashFromUrl(this.config.path) || this.config.hash;
    return documentHash ? null : this.config.initialViewState || null;
  }

  async applyDocumentView(viewState) {
    const defaults = this.config.defaults || {};
    this.pdfViewer.scrollMode = scrollMode(defaults.scrollMode);
    this.pdfViewer.spreadMode = spreadMode(defaults.spreadMode);
    const documentHash = hashFromUrl(this.config.path) || this.config.hash;
    const initialViewState = viewState;

    if (initialViewState) {
      this.pdfViewer.currentScaleValue = normalizeScale(
        initialViewState.scaleValue,
      );
      this.pdfViewer.currentPageNumber = Math.min(
        Math.max(initialViewState.pageNumber, 1),
        this.pdfViewer.pagesCount,
      );
      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          this.elements.container.scrollLeft = initialViewState.scrollLeft;
          this.elements.container.scrollTop = initialViewState.scrollTop;
          resolve();
        });
      });
      return;
    }

    this.pdfViewer.currentScaleValue = normalizeScale(defaults.scale);
    if (documentHash) {
      this.setHash(documentHash);
    }
  }

  captureViewState() {
    return {
      pageNumber: this.pdfViewer.currentPageNumber || 1,
      scaleValue: this.pdfViewer.currentScaleValue || 'auto',
      scrollLeft: Math.max(0, this.elements.container.scrollLeft),
      scrollTop: Math.max(0, this.elements.container.scrollTop),
      outlineVisible:
        !this.elements.outlineSidebar.classList.contains('hidden'),
      sidebarPanel: this.activeSidebarPanel,
    };
  }

  schedulePersistViewState() {
    if (this.viewStatePersistenceSuspended) {
      return;
    }
    clearTimeout(this.persistViewStateTimer);
    this.persistViewStateTimer = setTimeout(() => {
      this.persistViewStateTimer = null;
      this.flushPersistViewState();
    }, VIEW_STATE_PERSIST_DEBOUNCE_MS);
  }

  flushPersistViewState() {
    clearTimeout(this.persistViewStateTimer);
    this.persistViewStateTimer = null;
    if (this.viewStatePersistenceSuspended || !this.pdfDocument) {
      return;
    }
    vscode.postMessage({
      type: 'view-state',
      state: this.captureViewState(),
    });
  }

  setHash(hash) {
    try {
      this.linkService.setHash(decodeURIComponent(hash));
    } catch (error) {
      console.warn('PDF Preview: failed to apply document hash', error);
    }
  }

  goToPageFromInput() {
    const pageNumber = Number(this.elements.pageNumber.value);
    if (!Number.isInteger(pageNumber)) {
      this.updatePageControls();
      return;
    }
    this.pdfViewer.currentPageNumber = Math.min(
      Math.max(pageNumber, 1),
      this.pdfViewer.pagesCount,
    );
  }

  updatePageControls() {
    const pageNumber = this.pdfViewer.currentPageNumber || 1;
    const pagesCount = this.pdfViewer.pagesCount || 0;
    this.elements.pageNumber.value = String(pageNumber);
    this.elements.pageNumber.max = String(Math.max(pagesCount, 1));
    this.elements.numPages.textContent = pagesCount ? `of ${pagesCount}` : 'of —';
    this.elements.previous.disabled = pageNumber <= 1;
    this.elements.next.disabled = pageNumber >= pagesCount;
  }

  updateScaleSelect(scaleValue) {
    const normalizedScale = normalizeScale(scaleValue);
    if (SCALE_SELECT_VALUES.has(normalizedScale)) {
      this.removeCustomScaleOption();
      this.elements.scaleSelect.value = normalizedScale;
      return;
    }
    const numericScale = Number(normalizedScale);
    if (!Number.isFinite(numericScale)) {
      return;
    }
    // Keyboard and button zoom land between presets. Show the live percentage
    // in the control itself instead of leaving it reading a stale preset.
    const percent = Math.round(numericScale * 100);
    let customOption = this.elements.scaleSelect.querySelector(
      'option[value="custom"]',
    );
    if (!customOption) {
      customOption = document.createElement('option');
      customOption.value = 'custom';
      customOption.hidden = true;
      this.elements.scaleSelect.append(customOption);
    }
    customOption.textContent = `${percent}%`;
    this.elements.scaleSelect.value = 'custom';
  }

  removeCustomScaleOption() {
    const customOption = this.elements.scaleSelect.querySelector(
      'option[value="custom"]',
    );
    if (customOption) {
      customOption.remove();
    }
  }

  dispatchFind(type, findPrevious = false) {
    const query = this.elements.findInput.value;
    this.updateFindButtons();
    if (type === '' && query === this.findController.state?.query) {
      return;
    }
    this.eventBus.dispatch('find', {
      source: this,
      type,
      query,
      caseSensitive: false,
      entireWord: false,
      findPrevious,
      highlightAll:
        query.length >= FIND_HIGHLIGHT_ALL_MIN_QUERY_LENGTH &&
        this.pdfViewer.pagesCount <= FIND_HIGHLIGHT_ALL_MAX_PAGES,
      matchDiacritics: false,
    });
  }

  updateFindButtons() {
    const hasQuery = this.elements.findInput.value.length > 0;
    this.elements.findNext.disabled = !hasQuery;
    this.elements.findPrevious.disabled = !hasQuery;
    if (!hasQuery) {
      this.elements.findStatus.textContent = '';
    }
  }

  updateFindStatus(matchesCount) {
    if (!this.elements.findInput.value) {
      this.elements.findStatus.textContent = '';
      return;
    }
    if (matchesCount?.total) {
      this.elements.findStatus.textContent = `${matchesCount.current}/${matchesCount.total}`;
    }
  }

  updateFindControlState({ state, matchesCount, rawQuery }) {
    if (!rawQuery) {
      this.elements.findStatus.textContent = '';
      return;
    }
    if (state === FindState.PENDING) {
      this.elements.findStatus.textContent = '...';
      return;
    }
    if (state === FindState.NOT_FOUND) {
      this.elements.findStatus.textContent = 'No match';
      return;
    }
    this.updateFindStatus(matchesCount);
  }

  applyCursorDefault() {
    if (this.config.defaults?.cursor !== 'hand') {
      return;
    }

    const container = this.elements.container;
    container.classList.add('cursor-hand');
    let drag = null;

    container.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || isInteractiveTarget(event.target)) {
        return;
      }
      drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
      };
      container.classList.add('dragging');
      container.setPointerCapture(event.pointerId);
    });
    container.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      container.scrollLeft = drag.scrollLeft - (event.clientX - drag.x);
      container.scrollTop = drag.scrollTop - (event.clientY - drag.y);
    });
    const endDrag = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      drag = null;
      container.classList.remove('dragging');
      if (container.hasPointerCapture(event.pointerId)) {
        container.releasePointerCapture(event.pointerId);
      }
    };
    container.addEventListener('pointerup', endDrag);
    container.addEventListener('pointercancel', endDrag);
  }

  applyAppearance() {
    const appearance =
      this.appearance || normalizeAppearance(this.config.appearance);
    const preservedClasses = document.body.className
      .split(/\s+/)
      .filter(
        (className) =>
          className &&
          !className.startsWith('theme-') &&
          !className.startsWith('page-gap-'),
      );
    document.body.className = [
      ...preservedClasses,
      `theme-${appearance.theme}`,
      `page-gap-${appearance.pageGap}`,
    ].join(' ');
    applyPageColorVariables(this.elements.viewer, appearance.theme);
  }

  updateThemeToggle() {
    const currentLabel = themeLabel(this.appearance.theme);
    const nextLabel = themeLabel(nextCycleTheme(this.appearance.theme));
    const enabled = currentLabel !== 'Clear';
    const description = enabled
      ? `Switch PDF page mode to ${nextLabel} (Shift+click to clear)`
      : `Switch PDF page mode to ${nextLabel}`;
    this.elements.themeToggle.setAttribute('aria-pressed', String(enabled));
    this.elements.themeToggle.classList.toggle('is-active', enabled);
    this.elements.themeToggle.title = description;
    this.elements.themeToggle.setAttribute('aria-label', description);
    const label = this.elements.themeToggle.querySelector('.label');
    if (label) {
      label.textContent = currentLabel;
    }
  }

  setAutoReload(enabled) {
    this.automaticReload = enabled;
    this.config.reload = {
      ...(this.config.reload || {}),
      automatic: enabled,
    };
    this.updateAutoReloadToggle();
  }

  setAutoCopySelection(enabled) {
    this.config.copy = {
      ...(this.config.copy || {}),
      autoCopySelection: enabled,
    };
  }

  updateAutoReloadToggle() {
    this.elements.autoReloadToggle.setAttribute(
      'aria-pressed',
      String(this.automaticReload),
    );
    this.elements.autoReloadToggle.classList.toggle(
      'is-active',
      this.automaticReload,
    );
    const title = this.automaticReload
      ? 'Disable automatic reload'
      : 'Enable automatic reload';
    this.elements.autoReloadToggle.title = title;
    this.elements.autoReloadToggle.setAttribute('aria-label', title);
  }

  async populateOutline(pdfDocument, token, viewState) {
    let outline = null;
    try {
      outline = await pdfDocument.getOutline();
    } catch (error) {
      console.warn('PDF Preview: failed to load outline', error);
    }
    if (!this.isCurrentLoad(token, pdfDocument)) {
      return false;
    }

    this.elements.outlineTree.replaceChildren();
    const hasOutline = Array.isArray(outline) && outline.length > 0;
    this.elements.outlinePanelTab.disabled = !hasOutline;
    if (hasOutline) {
      this.renderOutlineItems(outline, this.elements.outlineTree, 0);
    }

    const preferredPanel = viewState
      ? normalizeSidebarPanel(viewState.sidebarPanel)
      : normalizeSidebarPanel(this.config.defaults?.sidebarPanel);
    this.setSidebarPanel(hasOutline ? preferredPanel : 'thumbnails');
    this.elements.outlineToggle.disabled = false;
    const visible =
      viewState?.outlineVisible ??
      this.outlineVisibleOverride ??
      this.config.defaults?.sidebar === true;
    this.setOutlineVisible(visible);
    return true;
  }

  renderOutlineItems(items, parent, depth) {
    for (const item of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `outline-item outline-depth-${Math.min(depth, 6)}`;
      row.textContent = item.title || 'Untitled';
      row.disabled = !item.dest;
      if (item.dest) {
        row.addEventListener('click', () => {
          void this.linkService.goToDestination(item.dest).catch((error) => {
            console.warn(
              'PDF Preview: failed to open outline destination',
              error,
            );
          });
          this.elements.container.focus();
        });
      }
      parent.append(row);

      if (Array.isArray(item.items) && item.items.length > 0) {
        this.renderOutlineItems(item.items, parent, depth + 1);
      }
    }
  }

  cancelThumbnailJobs() {
    for (const job of this.thumbnailRenderJobs.values()) {
      job.cancelled = true;
      try {
        job.renderTask?.cancel?.();
      } catch (error) {
        console.warn('PDF Preview: failed to cancel thumbnail render', error);
      }
    }
    this.thumbnailRenderJobs.clear();
    this.thumbnailRenderQueue = [];
  }

  resetThumbnails() {
    this.thumbnailRenderToken += 1;
    this.thumbnailObserver?.disconnect();
    this.thumbnailObserver = null;
    this.cancelThumbnailJobs();
    this.thumbnailCanvases.clear();
    this.activeThumbnailPage = null;
    this.visibleThumbnailPages.clear();
    this.elements.thumbnailList.replaceChildren();
  }

  populateThumbnails(pdfDocument, token) {
    if (!this.isCurrentLoad(token, pdfDocument)) {
      return;
    }
    this.resetThumbnails();
    this.thumbnailRenderToken = token;
    const fragment = document.createDocumentFragment();
    for (
      let pageNumber = 1;
      pageNumber <= pdfDocument.numPages;
      pageNumber += 1
    ) {
      fragment.append(this.createThumbnailItem(pageNumber));
    }
    this.elements.thumbnailList.append(fragment);

    if ('IntersectionObserver' in window) {
      this.thumbnailObserver = new IntersectionObserver(
        (entries) => this.handleThumbnailIntersections(entries),
        {
          root: this.elements.thumbnailPanel,
          rootMargin: '240px 0px',
          threshold: 0.01,
        },
      );
      for (const item of this.thumbnailItems()) {
        this.thumbnailObserver.observe(item);
      }
    } else {
      for (
        let pageNumber = 1;
        pageNumber <= Math.min(pdfDocument.numPages, THUMBNAIL_MAX_CANVASES);
        pageNumber += 1
      ) {
        this.queueThumbnailRender(pageNumber);
      }
    }
    this.updateActiveThumbnail();
    this.queueThumbnailRender(this.pdfViewer.currentPageNumber || 1, {
      priority: true,
    });
  }

  createThumbnailItem(pageNumber) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'thumbnail-item';
    item.dataset.pageNumber = String(pageNumber);
    item.setAttribute('aria-label', `Page ${pageNumber}`);
    item.setAttribute('aria-current', 'false');
    item.tabIndex = -1;

    const shell = document.createElement('span');
    shell.className = 'thumbnail-canvas-shell';
    shell.append(this.createThumbnailPlaceholder(pageNumber));

    const label = document.createElement('span');
    label.className = 'thumbnail-page-label';
    label.textContent = String(pageNumber);

    item.append(shell, label);
    item.addEventListener('click', () => {
      this.pdfViewer.currentPageNumber = pageNumber;
      this.elements.container.focus();
    });
    return item;
  }

  createThumbnailPlaceholder(pageNumber) {
    const placeholder = document.createElement('span');
    placeholder.className = 'thumbnail-placeholder';
    placeholder.textContent = String(pageNumber);
    return placeholder;
  }

  thumbnailItems() {
    return Array.from(
      this.elements.thumbnailList.querySelectorAll('.thumbnail-item'),
    );
  }

  thumbnailItem(pageNumber) {
    return this.elements.thumbnailList.querySelector(
      `.thumbnail-item[data-page-number="${pageNumber}"]`,
    );
  }

  handleThumbnailIntersections(entries) {
    for (const entry of entries) {
      const pageNumber = Number(entry.target.dataset.pageNumber);
      if (!Number.isInteger(pageNumber)) {
        continue;
      }
      if (entry.isIntersecting) {
        this.visibleThumbnailPages.add(pageNumber);
        this.queueThumbnailRender(pageNumber, {
          priority: pageNumber === (this.pdfViewer.currentPageNumber || 1),
        });
      } else {
        this.visibleThumbnailPages.delete(pageNumber);
        this.removeQueuedThumbnail(pageNumber);
        this.cancelThumbnailJob(pageNumber, { preserveActive: true });
      }
    }
    this.enforceThumbnailCanvasLimit();
    this.pumpThumbnailRenderQueue();
  }

  queueThumbnailRender(pageNumber, { priority = false } = {}) {
    const queuedIndex = this.thumbnailRenderQueue.indexOf(pageNumber);
    if (priority && queuedIndex >= 0) {
      this.thumbnailRenderQueue.splice(queuedIndex, 1);
      this.thumbnailRenderQueue.unshift(pageNumber);
      this.pumpThumbnailRenderQueue();
      return;
    }
    if (
      !this.pdfDocument ||
      this.thumbnailCanvases.has(pageNumber) ||
      this.thumbnailRenderJobs.has(pageNumber) ||
      queuedIndex >= 0
    ) {
      return;
    }
    const item = this.thumbnailItem(pageNumber);
    if (!item || !item.isConnected) {
      return;
    }
    if (priority) {
      this.thumbnailRenderQueue.unshift(pageNumber);
    } else {
      this.thumbnailRenderQueue.push(pageNumber);
    }
    this.pumpThumbnailRenderQueue();
  }

  removeQueuedThumbnail(pageNumber) {
    const index = this.thumbnailRenderQueue.indexOf(pageNumber);
    if (index >= 0) {
      this.thumbnailRenderQueue.splice(index, 1);
    }
  }

  cancelThumbnailJob(pageNumber, { preserveActive = false } = {}) {
    if (
      preserveActive &&
      pageNumber === (this.pdfViewer.currentPageNumber || 1)
    ) {
      return;
    }
    const job = this.thumbnailRenderJobs.get(pageNumber);
    if (!job) {
      return;
    }
    job.cancelled = true;
    this.thumbnailRenderJobs.delete(pageNumber);
    try {
      job.renderTask?.cancel?.();
    } catch (error) {
      console.warn('PDF Preview: failed to cancel thumbnail render', error);
    }
    this.pumpThumbnailRenderQueue();
  }

  shouldRenderQueuedThumbnail(pageNumber) {
    return (
      pageNumber === (this.pdfViewer.currentPageNumber || 1) ||
      this.visibleThumbnailPages.has(pageNumber)
    );
  }

  pumpThumbnailRenderQueue() {
    while (
      this.thumbnailRenderJobs.size < THUMBNAIL_MAX_RENDER_JOBS &&
      this.thumbnailRenderQueue.length > 0
    ) {
      const pageNumber = this.thumbnailRenderQueue.shift();
      if (!Number.isInteger(pageNumber)) {
        continue;
      }
      if (
        !this.pdfDocument ||
        this.thumbnailCanvases.has(pageNumber) ||
        this.thumbnailRenderJobs.has(pageNumber) ||
        !this.shouldRenderQueuedThumbnail(pageNumber)
      ) {
        continue;
      }
      const item = this.thumbnailItem(pageNumber);
      if (!item || !item.isConnected) {
        continue;
      }
      const job = {
        cancelled: false,
        item,
        pageNumber,
        pdfDocument: this.pdfDocument,
        renderTask: null,
        token: this.thumbnailRenderToken,
      };
      this.thumbnailRenderJobs.set(pageNumber, job);
      job.promise = this.renderThumbnailJob(job)
        .catch((error) => {
          if (!this.isThumbnailRenderCancelled(error)) {
            console.warn('PDF Preview: failed to render thumbnail', error);
          }
        })
        .finally(() => {
          if (this.thumbnailRenderJobs.get(pageNumber) === job) {
            this.thumbnailRenderJobs.delete(pageNumber);
          }
          this.pumpThumbnailRenderQueue();
        });
    }
  }

  isCurrentThumbnailJob(job) {
    return (
      !job.cancelled &&
      job.token === this.thumbnailRenderToken &&
      job.pdfDocument === this.pdfDocument &&
      this.thumbnailRenderJobs.get(job.pageNumber) === job &&
      job.item.isConnected
    );
  }

  isThumbnailRenderCancelled(error) {
    return (
      error?.name === 'RenderingCancelledException' ||
      error?.name === 'AbortException'
    );
  }

  async renderThumbnailJob(job) {
    let page = null;
    try {
      if (!this.isCurrentThumbnailJob(job)) {
        return;
      }
      page = await job.pdfDocument.getPage(job.pageNumber);
      if (!this.isCurrentThumbnailJob(job)) {
        return;
      }

      const baseViewport = page.getViewport({ scale: 1 });
      const cssScale = THUMBNAIL_CSS_WIDTH / baseViewport.width;
      const cssViewport = page.getViewport({ scale: cssScale });
      const devicePixelRatio = Math.min(
        window.devicePixelRatio || 1,
        THUMBNAIL_DEVICE_PIXEL_RATIO_MAX,
      );
      const renderViewport = page.getViewport({
        scale: cssScale * devicePixelRatio,
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(renderViewport.width);
      canvas.height = Math.ceil(renderViewport.height);
      canvas.style.width = `${Math.ceil(cssViewport.width)}px`;
      canvas.style.height = `${Math.ceil(cssViewport.height)}px`;
      canvas.setAttribute('aria-hidden', 'true');

      const canvasContext = canvas.getContext('2d');
      if (!canvasContext) {
        return;
      }
      const renderTask = page.render({
        canvasContext,
        viewport: renderViewport,
      });
      job.renderTask = renderTask;
      await renderTask.promise;
      if (!this.isCurrentThumbnailJob(job)) {
        return;
      }

      const shell = job.item.querySelector('.thumbnail-canvas-shell');
      if (!shell) {
        return;
      }
      shell.replaceChildren(canvas);
      this.thumbnailCanvases.set(job.pageNumber, {
        item: job.item,
        lastUsed: ++this.thumbnailUseCounter,
      });
      this.enforceThumbnailCanvasLimit();
    } finally {
      page?.cleanup?.();
    }
  }

  enforceThumbnailCanvasLimit() {
    const canvasLimit = Math.max(
      THUMBNAIL_MAX_CANVASES,
      this.visibleThumbnailPages.size + 1,
    );
    if (this.thumbnailCanvases.size <= canvasLimit) {
      return;
    }
    const activePage = this.pdfViewer.currentPageNumber || 1;
    const candidates = Array.from(this.thumbnailCanvases.entries())
      .filter(
        ([pageNumber]) =>
          pageNumber !== activePage && !this.visibleThumbnailPages.has(pageNumber),
      )
      .sort(([, left], [, right]) => left.lastUsed - right.lastUsed);
    for (const [pageNumber] of candidates) {
      if (this.thumbnailCanvases.size <= canvasLimit) {
        break;
      }
      this.removeThumbnailCanvas(pageNumber);
    }
  }

  removeThumbnailCanvas(pageNumber) {
    const record = this.thumbnailCanvases.get(pageNumber);
    if (!record) {
      return;
    }
    const shell = record.item.querySelector('.thumbnail-canvas-shell');
    if (shell) {
      shell.replaceChildren(this.createThumbnailPlaceholder(pageNumber));
    }
    this.thumbnailCanvases.delete(pageNumber);
  }

  updateActiveThumbnail() {
    const activePage = this.pdfViewer.currentPageNumber || 1;
    if (this.activeThumbnailPage !== activePage) {
      const previousItem =
        this.activeThumbnailPage === null
          ? null
          : this.thumbnailItem(this.activeThumbnailPage);
      if (previousItem) {
        previousItem.classList.remove('is-active');
        previousItem.setAttribute('aria-current', 'false');
        previousItem.tabIndex = -1;
      }
      const activeItem = this.thumbnailItem(activePage);
      if (activeItem) {
        activeItem.classList.add('is-active');
        activeItem.setAttribute('aria-current', 'page');
        activeItem.tabIndex = 0;
        this.activeThumbnailPage = activePage;
      } else {
        this.activeThumbnailPage = null;
      }
    }
    this.queueThumbnailRender(activePage, { priority: true });
  }

  scrollActiveThumbnailIntoView() {
    this.thumbnailItem(this.pdfViewer.currentPageNumber || 1)?.scrollIntoView({
      block: 'nearest',
    });
  }

  handleThumbnailKeydown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const currentItem =
      event.target instanceof Element
        ? event.target.closest('.thumbnail-item')
        : null;
    if (!currentItem) {
      return;
    }
    const items = this.thumbnailItems();
    const index = items.indexOf(currentItem);
    if (index < 0) {
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = Math.min(
        Math.max(index + (event.key === 'ArrowDown' ? 1 : -1), 0),
        items.length - 1,
      );
      items[nextIndex]?.focus();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      currentItem.click();
    }
  }

  setSidebarPanel(panel, { remember = false } = {}) {
    this.activeSidebarPanel = normalizeSidebarPanel(panel);
    const showOutline = this.activeSidebarPanel === 'outline';
    this.elements.outlinePanel.classList.toggle('hidden', !showOutline);
    this.elements.outlinePanel.hidden = !showOutline;
    this.elements.thumbnailPanel.classList.toggle('hidden', showOutline);
    this.elements.thumbnailPanel.hidden = showOutline;
    this.elements.outlinePanelTab.classList.toggle('is-active', showOutline);
    this.elements.thumbnailPanelTab.classList.toggle('is-active', !showOutline);
    this.elements.outlinePanelTab.setAttribute(
      'aria-selected',
      String(showOutline),
    );
    this.elements.thumbnailPanelTab.setAttribute(
      'aria-selected',
      String(!showOutline),
    );
    if (!showOutline) {
      requestAnimationFrame(() => this.scrollActiveThumbnailIntoView());
    }
    this.updateSidebarToggle();
    if (remember) {
      this.schedulePersistViewState();
    }
  }

  setOutlineVisible(visible, { remember = false } = {}) {
    this.elements.outlineSidebar.classList.toggle('hidden', !visible);
    if (visible && this.activeSidebarPanel === 'thumbnails') {
      requestAnimationFrame(() => this.scrollActiveThumbnailIntoView());
    }
    this.updateSidebarToggle();
    if (remember) {
      this.outlineVisibleOverride = visible;
      this.schedulePersistViewState();
    }
  }

  updateSidebarToggle() {
    const visible = !this.elements.outlineSidebar.classList.contains('hidden');
    const labelText = sidebarPanelLabel(this.activeSidebarPanel);
    this.elements.outlineToggle.setAttribute('aria-expanded', String(visible));
    this.elements.outlineToggle.classList.toggle('is-active', visible);
    this.elements.outlineToggle.title = `Toggle ${labelText.toLowerCase()} sidebar`;
    this.elements.outlineToggle.setAttribute(
      'aria-label',
      `Toggle ${labelText.toLowerCase()} sidebar`,
    );
    const label = this.elements.outlineToggle.querySelector('.label');
    if (label) {
      label.textContent = labelText;
    }
  }

  handleViewerKeydown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (
      event.target instanceof Element &&
      event.target.closest('input, select, textarea, button, [contenteditable]')
    ) {
      return;
    }

    let handled = true;
    switch (event.key) {
      case 'j':
        this.elements.container.scrollBy({ top: 80 });
        break;
      case 'k':
        this.elements.container.scrollBy({ top: -80 });
        break;
      case 'h':
        this.elements.container.scrollBy({ left: -80 });
        break;
      case 'l':
        this.elements.container.scrollBy({ left: 80 });
        break;
      case 'n':
      case '.':
        this.pdfViewer.currentPageNumber += 1;
        break;
      case 'p':
      case ',':
        this.pdfViewer.currentPageNumber -= 1;
        break;
      case 'g':
        this.pdfViewer.currentPageNumber = 1;
        break;
      case 'G':
        this.pdfViewer.currentPageNumber = this.pdfViewer.pagesCount;
        break;
      case '+':
      case '=':
        this.pdfViewer.increaseScale();
        break;
      case '-':
        this.pdfViewer.decreaseScale();
        break;
      default:
        handled = false;
    }

    if (handled) {
      event.preventDefault();
    }
  }

  showPasswordPrompt(updatePassword, reason) {
    this.pendingPasswordUpdate = updatePassword;
    this.elements.passwordMessage.textContent =
      reason === PasswordResponses.INCORRECT_PASSWORD
        ? 'Incorrect password. Please try again.'
        : 'Enter the password to open this PDF.';
    this.elements.passwordInput.value = '';
    this.elements.passwordOverlay.classList.remove('hidden');
    this.elements.passwordInput.focus();
  }

  submitPassword() {
    if (!this.pendingPasswordUpdate) {
      return;
    }
    const password = this.elements.passwordInput.value;
    if (!password) {
      this.elements.passwordInput.focus();
      return;
    }
    const updatePassword = this.pendingPasswordUpdate;
    this.hidePasswordPrompt();
    updatePassword(password);
  }

  cancelPasswordPrompt() {
    this.loadToken += 1;
    this.clearReloadRetry();
    this.hidePasswordPrompt();
    this.destroyLoadingTask();
    this.setStatus('Password entry cancelled.');
  }

  destroyLoadingTask() {
    const loadingTask = this.loadingTask;
    this.loadingTask = null;
    if (loadingTask) {
      this.pendingTaskDestruction = Promise.resolve(loadingTask.destroy())
        .catch((error) => {
          console.warn('PDF Preview: failed to destroy loading task', error);
        });
    }
  }

  hidePasswordPrompt() {
    this.pendingPasswordUpdate = null;
    this.elements.passwordOverlay.classList.add('hidden');
  }

  setStatus(message) {
    this.elements.status.textContent = message;
    this.elements.status.title = message;
    this.elements.status.classList.toggle('is-visible', message.length > 0);
  }

  waitForPageRendered(pageNumber, { rejectOnError = false } = {}) {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const finish = () => {
        clearTimeout(timeoutTimer);
        controller.abort();
        resolve();
      };
      const fail = (error) => {
        clearTimeout(timeoutTimer);
        controller.abort();
        reject(error);
      };

      const pageView = this.pdfViewer.getPageView(pageNumber - 1);
      if (pageView?.renderingState === RenderingStates.FINISHED) {
        resolve();
        return;
      }

      const timeoutTimer = setTimeout(() => {
        if (rejectOnError) {
          fail(new Error(`Timed out waiting for page ${pageNumber} to render`));
        } else {
          finish();
        }
      }, 30000);
      this.eventBus.on(
        'pagerendered',
        (event) => {
          if (event.pageNumber === pageNumber) {
            if (rejectOnError && event.error) {
              fail(event.error);
              return;
            }
            finish();
          }
        },
        { signal: controller.signal },
      );
    });
  }
}

const startApp = async () => {
  const app = new PdfPreviewApp();
  const dedicatedWorker = await createPdfWorker(app.config);
  if (dedicatedWorker) {
    GlobalWorkerOptions.workerPort = dedicatedWorker;
  }
  app.loadDocument();
};

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}
