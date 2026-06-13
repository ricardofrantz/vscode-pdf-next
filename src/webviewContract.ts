import * as vscode from 'vscode';

export interface PersistedViewState {
  pageNumber: number;
  scaleValue: string;
  scrollLeft: number;
  scrollTop: number;
  outlineVisible?: boolean;
  sidebarPanel?: 'outline' | 'thumbnails';
}

export type ViewerToHostMessage =
  | {
      type: 'appearance-theme';
      theme:
        | 'auto'
        | 'light'
        | 'dark'
        | 'night'
        | 'reader'
        | 'dark-pages'
        | 'inverted';
    }
  | { type: 'copy-text'; text: string }
  | { type: 'open-external' }
  | { type: 'open-pdf-link'; href: string }
  | { type: 'open-source' }
  | { type: 'print-request' }
  | { type: 'set-auto-reload'; enabled: boolean }
  | { type: 'view-state'; state: PersistedViewState }
  | { type: 'viewer-ready'; pagesCount: number; pageNumber: number }
  | { type: 'viewer-error'; message: string };

export type HostToViewerMessage =
  | { type: 'auto-reload-state'; enabled: boolean }
  | { type: 'copy-auto-selection-state'; enabled: boolean }
  | { type: 'file-deleted' }
  | { type: 'reload' }
  | { type: 'reset-view-state' };

export type ViewerEvent =
  | {
      type: 'viewer-ready';
      resource: string;
      pagesCount: number;
      pageNumber: number;
    }
  | { type: 'viewer-error'; resource: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function hasExpectedKeys(
  value: Record<string, unknown>,
  requiredKeys: string[],
  optionalKeys: string[] = [],
): boolean {
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      return false;
    }
  }

  for (const key of Object.keys(value)) {
    if (!requiredKeys.includes(key) && !optionalKeys.includes(key)) {
      return false;
    }
  }

  return true;
}

export function isPersistedViewState(
  value: unknown,
): value is PersistedViewState {
  if (
    !isRecord(value) ||
    !hasExpectedKeys(
      value,
      ['pageNumber', 'scaleValue', 'scrollLeft', 'scrollTop'],
      ['outlineVisible', 'sidebarPanel'],
    )
  ) {
    return false;
  }

  return (
    typeof value.pageNumber === 'number' &&
    Number.isInteger(value.pageNumber) &&
    value.pageNumber > 0 &&
    typeof value.scaleValue === 'string' &&
    typeof value.scrollLeft === 'number' &&
    Number.isFinite(value.scrollLeft) &&
    typeof value.scrollTop === 'number' &&
    Number.isFinite(value.scrollTop) &&
    (value.outlineVisible === undefined ||
      typeof value.outlineVisible === 'boolean') &&
    (value.sidebarPanel === undefined ||
      value.sidebarPanel === 'outline' ||
      value.sidebarPanel === 'thumbnails')
  );
}

export function parseViewerToHostMessage(
  message: unknown,
): ViewerToHostMessage | undefined {
  if (!isRecord(message) || typeof message.type !== 'string') {
    return undefined;
  }

  switch (message.type) {
    case 'open-source':
      if (hasExpectedKeys(message, ['type'])) {
        return { type: 'open-source' };
      }
      break;

    case 'open-external':
      if (hasExpectedKeys(message, ['type'])) {
        return { type: 'open-external' };
      }
      break;

    case 'print-request':
      if (hasExpectedKeys(message, ['type'])) {
        return { type: 'print-request' };
      }
      break;

    case 'set-auto-reload':
      if (
        hasExpectedKeys(message, ['type', 'enabled']) &&
        typeof message.enabled === 'boolean'
      ) {
        return { type: 'set-auto-reload', enabled: message.enabled };
      }
      break;

    case 'copy-text':
      if (
        hasExpectedKeys(message, ['type', 'text']) &&
        typeof message.text === 'string' &&
        message.text.length > 0 &&
        message.text.length <= 1_000_000
      ) {
        return { type: 'copy-text', text: message.text };
      }
      break;

    case 'open-pdf-link':
      if (
        hasExpectedKeys(message, ['type', 'href']) &&
        typeof message.href === 'string' &&
        message.href.length > 0
      ) {
        return { type: 'open-pdf-link', href: message.href };
      }
      break;

    case 'appearance-theme':
      if (
        hasExpectedKeys(message, ['type', 'theme']) &&
        typeof message.theme === 'string' &&
        (message.theme === 'auto' ||
          message.theme === 'light' ||
          message.theme === 'dark' ||
          message.theme === 'night' ||
          message.theme === 'reader' ||
          message.theme === 'dark-pages' ||
          message.theme === 'inverted')
      ) {
        return { type: 'appearance-theme', theme: message.theme };
      }
      break;

    case 'view-state':
      if (
        hasExpectedKeys(message, ['type', 'state']) &&
        isPersistedViewState(message.state)
      ) {
        return { type: 'view-state', state: message.state };
      }
      break;

    case 'viewer-ready':
      if (
        hasExpectedKeys(message, ['type', 'pagesCount', 'pageNumber']) &&
        typeof message.pagesCount === 'number' &&
        Number.isInteger(message.pagesCount) &&
        message.pagesCount > 0 &&
        typeof message.pageNumber === 'number' &&
        Number.isInteger(message.pageNumber) &&
        message.pageNumber > 0
      ) {
        return {
          type: 'viewer-ready',
          pagesCount: message.pagesCount,
          pageNumber: message.pageNumber,
        };
      }
      break;

    case 'viewer-error':
      if (
        hasExpectedKeys(message, ['type', 'message']) &&
        typeof message.message === 'string'
      ) {
        return { type: 'viewer-error', message: message.message };
      }
      break;
  }

  return undefined;
}

export function viewStateKey(resource: vscode.Uri): string {
  return `pdf-preview-next.view-state:${resource.with({ fragment: '' }).toString()}`;
}

export function persistedViewStateOrUndefined(
  value: unknown,
): PersistedViewState | undefined {
  return isPersistedViewState(value) ? value : undefined;
}
