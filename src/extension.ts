import * as vscode from 'vscode';
import { PdfCustomProvider } from './pdfProvider';

export const PDF_WEBVIEW_OPTIONS = {
  enableFindWidget: false,
  retainContextWhenHidden: false,
} satisfies vscode.WebviewPanelOptions;

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PdfCustomProvider(
    context.extensionUri,
    context.workspaceState,
  );
  if (context.extensionMode === vscode.ExtensionMode.Test) {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'pdf-preview.internal.waitForViewerEvent',
        async (
          resource: string,
          timeoutMs?: number,
          afterReceivedAt?: number,
        ) => provider.waitForViewerEvent(resource, timeoutMs, afterReceivedAt),
      ),
    );
  }

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      PdfCustomProvider.viewType,
      provider,
      {
        webviewOptions: PDF_WEBVIEW_OPTIONS,
      },
    ),
    vscode.commands.registerCommand(
      'pdf-preview.openPreview',
      async (uri?: vscode.Uri) => {
        let target = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!target) {
          const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { PDF: ['pdf'] },
          });
          target = picked?.[0];
        }
        if (!target) {
          return;
        }
        await vscode.commands.executeCommand(
          'vscode.openWith',
          target,
          PdfCustomProvider.viewType,
        );
      },
    ),
    vscode.commands.registerCommand('pdf-preview.openSource', async () => {
      await provider.openSourceForActivePreview();
    }),
    vscode.commands.registerCommand('pdf-preview.refreshPreview', async () => {
      await provider.refreshActivePreview();
    }),
    vscode.commands.registerCommand('pdf-preview.print', async () => {
      await provider.printActivePreview();
    }),
    vscode.commands.registerCommand('pdf-preview.printDirect', async () => {
      await provider.printDirectActivePreview();
    }),
    vscode.commands.registerCommand('pdf-preview.clearPageMode', async () => {
      await provider.clearPageModeForActivePreview();
    }),
    vscode.commands.registerCommand('pdf-preview.resetViewState', async () => {
      await provider.resetViewStateForActivePreview();
    }),
  );
}

export function deactivate(): void {}
