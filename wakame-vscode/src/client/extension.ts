/**
 * Wakame VSCode Extension
 * Japanese text analysis and proofreading
 */

import * as path from 'path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node.js';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext): void {
  // Path to the server module
  const serverModule = context.asAbsolutePath(path.join('dist', 'server', 'server.js'));

  // Server options
  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: {
        execArgv: ['--nolazy', '--inspect=6009'],
      },
    },
  };

  // Languages to activate on
  const documentSelector = [
    { scheme: 'file', language: 'plaintext' },
    { scheme: 'file', language: 'markdown' },
    { scheme: 'file', language: 'japanese' },
    { scheme: 'file', language: 'latex' },
    { scheme: 'file', language: 'html' },
    { scheme: 'file', language: 'javascript' },
    { scheme: 'file', language: 'typescript' },
    { scheme: 'file', language: 'python' },
    { scheme: 'file', language: 'rust' },
    { scheme: 'file', language: 'c' },
    { scheme: 'file', language: 'cpp' },
    { scheme: 'untitled', language: 'plaintext' },
    { scheme: 'untitled', language: 'markdown' },
  ];

  // Client options
  const clientOptions: LanguageClientOptions = {
    documentSelector,
    synchronize: {
      configurationSection: 'wakame',
    },
    outputChannelName: 'Wakame Japanese Linter',
  };

  // Create the language client
  client = new LanguageClient(
    'wakame',
    'Wakame Japanese Linter',
    serverOptions,
    clientOptions
  );

  // Register commands
  const analyzeCommand = vscode.commands.registerCommand(
    'wakame.analyzeDocument',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await vscode.commands.executeCommand('editor.action.triggerSuggest');
        vscode.window.showInformationMessage('Wakame: Document analysis triggered');
      }
    }
  );

  const showTokenInfoCommand = vscode.commands.registerCommand(
    'wakame.showTokenInfo',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        // Trigger hover at current position
        await vscode.commands.executeCommand(
          'editor.action.showHover',
          { position: editor.selection.active }
        );
      }
    }
  );

  context.subscriptions.push(analyzeCommand, showTokenInfoCommand);

  // Start the client
  client.start();

  // Show welcome message
  vscode.window.showInformationMessage(
    'Wakame Japanese Linter is now active. Open a document with Japanese text to start analyzing.'
  );
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
