/**
 * MoZuku LSP Server
 * Japanese text analysis and proofreading
 */

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  Diagnostic,
  DiagnosticSeverity,
  DidChangeConfigurationNotification,
  SemanticTokensLegend,
  SemanticTokensBuilder,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  initializeTokenizer,
  analyze,
  calculateJapaneseRatio,
  isTokenizerReady,
} from './analyzer.js';
import { checkGrammar } from './grammar.js';
import type { MozukuConfig, DiagnosticInfo } from '../shared/types.js';
import { defaultConfig } from '../shared/types.js';

// Create LSP connection
const connection = createConnection(ProposedFeatures.all);

// Document manager
const documents = new TextDocuments(TextDocument);

// Configuration
let globalConfig: MozukuConfig = { ...defaultConfig };
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

// Semantic token types for Japanese POS
const tokenTypes = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'particle',
  'auxiliary',
  'conjunction',
  'symbol',
  'interjection',
  'prefix',
  'suffix',
  'unknown',
];

const tokenModifiers = ['numeric'];

const legend: SemanticTokensLegend = {
  tokenTypes,
  tokenModifiers,
};

/**
 * Map Japanese POS to semantic token type
 */
function posToTokenType(pos: string): number {
  const mapping: Record<string, number> = {
    '名詞': 0, // noun
    '動詞': 1, // verb
    '形容詞': 2, // adjective
    '副詞': 3, // adverb
    '助詞': 4, // particle
    '助動詞': 5, // auxiliary
    '接続詞': 6, // conjunction
    '記号': 7, // symbol
    '感動詞': 8, // interjection
    '接頭詞': 9, // prefix
    '接尾辞': 10, // suffix
  };
  return mapping[pos] ?? 11; // unknown
}

/**
 * Initialize connection
 */
connection.onInitialize((params: InitializeParams): InitializeResult => {
  const capabilities = params.capabilities;

  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      hoverProvider: true,
      semanticTokensProvider: {
        legend,
        full: true,
      },
    },
  };

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }

  return result;
});

/**
 * After initialization, start the tokenizer
 */
connection.onInitialized(async () => {
  if (hasConfigurationCapability) {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }

  // Initialize kuromoji tokenizer
  try {
    connection.console.log('MoZuku: Initializing Japanese tokenizer...');
    await initializeTokenizer();
    connection.console.log('MoZuku: Tokenizer initialized successfully');

    // Validate all open documents
    for (const doc of documents.all()) {
      await validateTextDocument(doc);
    }
  } catch (error) {
    connection.console.error(`MoZuku: Failed to initialize tokenizer: ${error}`);
  }
});

/**
 * Handle configuration changes
 */
connection.onDidChangeConfiguration(async (change) => {
  if (hasConfigurationCapability) {
    // Reset config
    globalConfig = { ...defaultConfig };
  } else {
    globalConfig = (change.settings?.mozuku || defaultConfig) as MozukuConfig;
  }

  // Revalidate all open documents
  for (const doc of documents.all()) {
    await validateTextDocument(doc);
  }
});

/**
 * Get document-specific configuration
 */
async function getDocumentConfig(uri: string): Promise<MozukuConfig> {
  if (!hasConfigurationCapability) {
    return globalConfig;
  }

  const result = await connection.workspace.getConfiguration({
    scopeUri: uri,
    section: 'mozuku',
  });

  return {
    enable: result?.enable ?? defaultConfig.enable,
    targetLanguages: result?.targetLanguages ?? defaultConfig.targetLanguages,
    minJapaneseRatio: result?.minJapaneseRatio ?? defaultConfig.minJapaneseRatio,
    rules: {
      commaLimit: result?.rules?.commaLimit ?? defaultConfig.rules.commaLimit,
      commaLimitMax: result?.rules?.commaLimitMax ?? defaultConfig.rules.commaLimitMax,
      adversativeGa: result?.rules?.adversativeGa ?? defaultConfig.rules.adversativeGa,
      adversativeGaMax: result?.rules?.adversativeGaMax ?? defaultConfig.rules.adversativeGaMax,
      duplicateParticle: result?.rules?.duplicateParticle ?? defaultConfig.rules.duplicateParticle,
      adjacentParticles: result?.rules?.adjacentParticles ?? defaultConfig.rules.adjacentParticles,
      conjunctionRepeat: result?.rules?.conjunctionRepeat ?? defaultConfig.rules.conjunctionRepeat,
      raDropping: result?.rules?.raDropping ?? defaultConfig.rules.raDropping,
    },
  };
}

/**
 * Validate a text document
 */
async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  if (!isTokenizerReady()) {
    return;
  }

  const config = await getDocumentConfig(textDocument.uri);

  if (!config.enable) {
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
    return;
  }

  const text = textDocument.getText();

  // Check Japanese ratio
  const japaneseRatio = calculateJapaneseRatio(text);
  if (japaneseRatio < config.minJapaneseRatio) {
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
    return;
  }

  try {
    // Analyze text
    const { sentences } = analyze(text);

    // Run grammar checks
    const diagnosticInfos = checkGrammar(text, sentences, config);

    // Convert to LSP diagnostics
    const diagnostics: Diagnostic[] = diagnosticInfos.map((info: DiagnosticInfo) => ({
      range: {
        start: info.start,
        end: info.end,
      },
      message: info.message,
      severity: info.severity as DiagnosticSeverity,
      code: info.code,
      source: info.source,
    }));

    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
  } catch (error) {
    connection.console.error(`MoZuku: Analysis error: ${error}`);
  }
}

/**
 * Handle hover requests
 */
connection.onHover(async (params) => {
  if (!isTokenizerReady()) {
    return null;
  }

  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const config = await getDocumentConfig(document.uri);
  if (!config.enable) {
    return null;
  }

  const text = document.getText();
  const offset = document.offsetAt(params.position);

  try {
    const { tokens } = analyze(text);

    // Find token at position
    for (const token of tokens) {
      if (offset >= token.offset && offset < token.offset + token.surface.length) {
        const hoverContent = [
          `**${token.surface}**`,
          '',
          `| 項目 | 値 |`,
          `|------|------|`,
          `| 品詞 | ${token.pos} |`,
          `| 品詞細分類1 | ${token.posDetail1} |`,
          `| 品詞細分類2 | ${token.posDetail2} |`,
          `| 品詞細分類3 | ${token.posDetail3} |`,
          `| 活用型 | ${token.conjugationType} |`,
          `| 活用形 | ${token.conjugationForm} |`,
          `| 基本形 | ${token.baseForm} |`,
          `| 読み | ${token.reading} |`,
          `| 発音 | ${token.pronunciation} |`,
        ].join('\n');

        return {
          contents: {
            kind: 'markdown',
            value: hoverContent,
          },
        };
      }
    }
  } catch (error) {
    connection.console.error(`MoZuku: Hover error: ${error}`);
  }

  return null;
});

/**
 * Handle semantic tokens request
 */
connection.languages.semanticTokens.on(async (params) => {
  if (!isTokenizerReady()) {
    return { data: [] };
  }

  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return { data: [] };
  }

  const config = await getDocumentConfig(document.uri);
  if (!config.enable) {
    return { data: [] };
  }

  const text = document.getText();
  const japaneseRatio = calculateJapaneseRatio(text);
  if (japaneseRatio < config.minJapaneseRatio) {
    return { data: [] };
  }

  try {
    const { tokens } = analyze(text);
    const builder = new SemanticTokensBuilder();

    for (const token of tokens) {
      const pos = document.positionAt(token.offset);
      const tokenType = posToTokenType(token.pos);
      const tokenModifier = token.posDetail1 === '数' ? 1 : 0; // numeric modifier

      builder.push(
        pos.line,
        pos.character,
        token.surface.length,
        tokenType,
        tokenModifier
      );
    }

    return builder.build();
  } catch (error) {
    connection.console.error(`MoZuku: Semantic tokens error: ${error}`);
    return { data: [] };
  }
});

// Document event handlers
documents.onDidChangeContent(async (change) => {
  await validateTextDocument(change.document);
});

documents.onDidClose((event) => {
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// Start listening
documents.listen(connection);
connection.listen();
