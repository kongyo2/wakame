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
  extractComments,
  extractHtmlContent,
  extractLatexContent,
} from './analyzer.js';
import { checkGrammar } from './grammar.js';
import { fetchWikipediaSummary } from './wikipedia.js';
import type { MozukuConfig, Token } from '../shared/types.js';
import { defaultConfig } from '../shared/types.js';

// Create LSP connection
const connection = createConnection(ProposedFeatures.all);

// Document manager
const documents = new TextDocuments(TextDocument);

// Configuration
let globalConfig: MozukuConfig = { ...defaultConfig };
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

// Semantic token types for Japanese POS (matching MoZuku)
const tokenTypes = [
  'noun', // 名詞
  'verb', // 動詞
  'adjective', // 形容詞
  'adverb', // 副詞
  'particle', // 助詞
  'auxiliary', // 助動詞
  'conjunction', // 接続詞
  'symbol', // 記号
  'interjection', // 感動詞
  'prefix', // 接頭詞
  'suffix', // 接尾辞
  'unknown', // 未知語
];

// Token modifiers (matching MoZuku)
const tokenModifiers = ['proper', 'numeric', 'kana', 'kanji'];

const legend: SemanticTokensLegend = {
  tokenTypes,
  tokenModifiers,
};

/**
 * Map Japanese POS to semantic token type index
 */
function posToTokenType(pos: string): number {
  const mapping: Record<string, number> = {
    名詞: 0,
    動詞: 1,
    形容詞: 2,
    副詞: 3,
    助詞: 4,
    助動詞: 5,
    接続詞: 6,
    記号: 7,
    感動詞: 8,
    接頭詞: 9,
    接尾辞: 10,
  };
  return mapping[pos] ?? 11;
}

/**
 * Compute modifier bitmask from token
 */
function computeModifierMask(token: Token): number {
  let mask = 0;
  if (token.modifiers) {
    if (token.modifiers.proper) mask |= 1 << 0;
    if (token.modifiers.numeric) mask |= 1 << 1;
    if (token.modifiers.kana) mask |= 1 << 2;
    if (token.modifiers.kanji) mask |= 1 << 3;
  }
  return mask;
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
        range: true,
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
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
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
    connection.console.error(
      `MoZuku: Failed to initialize tokenizer: ${error}`
    );
  }
});

/**
 * Handle configuration changes
 */
connection.onDidChangeConfiguration(async (change) => {
  if (hasConfigurationCapability) {
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
    minJapaneseRatio:
      result?.minJapaneseRatio ?? defaultConfig.minJapaneseRatio,
    warningMinSeverity:
      result?.warningMinSeverity ?? defaultConfig.warningMinSeverity,
    enableWikipedia: result?.enableWikipedia ?? defaultConfig.enableWikipedia,
    rules: {
      commaLimit: result?.rules?.commaLimit ?? defaultConfig.rules.commaLimit,
      commaLimitMax:
        result?.rules?.commaLimitMax ?? defaultConfig.rules.commaLimitMax,
      adversativeGa:
        result?.rules?.adversativeGa ?? defaultConfig.rules.adversativeGa,
      adversativeGaMax:
        result?.rules?.adversativeGaMax ?? defaultConfig.rules.adversativeGaMax,
      duplicateParticle:
        result?.rules?.duplicateParticle ??
        defaultConfig.rules.duplicateParticle,
      duplicateParticleMaxRepeat:
        result?.rules?.duplicateParticleMaxRepeat ??
        defaultConfig.rules.duplicateParticleMaxRepeat,
      adjacentParticles:
        result?.rules?.adjacentParticles ??
        defaultConfig.rules.adjacentParticles,
      adjacentParticlesMaxRepeat:
        result?.rules?.adjacentParticlesMaxRepeat ??
        defaultConfig.rules.adjacentParticlesMaxRepeat,
      conjunctionRepeat:
        result?.rules?.conjunctionRepeat ??
        defaultConfig.rules.conjunctionRepeat,
      conjunctionRepeatMax:
        result?.rules?.conjunctionRepeatMax ??
        defaultConfig.rules.conjunctionRepeatMax,
      raDropping: result?.rules?.raDropping ?? defaultConfig.rules.raDropping,
    },
    warnings: {
      particleDuplicate:
        result?.warnings?.particleDuplicate ??
        defaultConfig.warnings.particleDuplicate,
      particleSequence:
        result?.warnings?.particleSequence ??
        defaultConfig.warnings.particleSequence,
      particleMismatch:
        result?.warnings?.particleMismatch ??
        defaultConfig.warnings.particleMismatch,
      sentenceStructure:
        result?.warnings?.sentenceStructure ??
        defaultConfig.warnings.sentenceStructure,
      styleConsistency:
        result?.warnings?.styleConsistency ??
        defaultConfig.warnings.styleConsistency,
      redundancy:
        result?.warnings?.redundancy ?? defaultConfig.warnings.redundancy,
    },
  };
}

/**
 * Determine if language is a code language that needs comment extraction
 */
function isCodeLanguage(languageId: string): boolean {
  return [
    'javascript',
    'typescript',
    'javascriptreact',
    'typescriptreact',
    'python',
    'rust',
    'c',
    'cpp',
  ].includes(languageId);
}

/**
 * Get text to analyze based on document language
 */
function getAnalyzableText(
  text: string,
  languageId: string
): { text: string; offset: number }[] {
  // For plain text/markdown/japanese - analyze entire document
  if (['plaintext', 'markdown', 'japanese'].includes(languageId)) {
    return [{ text, offset: 0 }];
  }

  // For HTML - extract text content
  if (languageId === 'html') {
    const contents = extractHtmlContent(text);
    return contents.map((c) => ({ text: c.text, offset: c.start }));
  }

  // For LaTeX - extract text content
  if (languageId === 'latex') {
    const contents = extractLatexContent(text);
    return contents.map((c) => ({ text: c.text, offset: c.start }));
  }

  // For code languages - extract comments
  if (isCodeLanguage(languageId)) {
    const comments = extractComments(text, languageId);
    return comments.map((c) => ({ text: c.text, offset: c.start }));
  }

  // Default: analyze entire document
  return [{ text, offset: 0 }];
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
  const languageId = textDocument.languageId;

  // Get analyzable text segments
  const segments = getAnalyzableText(text, languageId);

  const allDiagnostics: Diagnostic[] = [];

  try {
    for (const segment of segments) {
      // Check Japanese ratio for each segment
      const japaneseRatio = calculateJapaneseRatio(segment.text);
      if (japaneseRatio < config.minJapaneseRatio) {
        continue;
      }

      // Analyze segment
      const { sentences } = analyze(segment.text);

      // Run grammar checks
      const diagnosticInfos = checkGrammar(segment.text, sentences, config);

      // Filter by severity
      const filteredDiagnostics = diagnosticInfos.filter(
        (d) => d.severity <= config.warningMinSeverity
      );

      // Convert to LSP diagnostics with offset adjustment
      for (const info of filteredDiagnostics) {
        // Adjust positions for segment offset
        const startPos = textDocument.positionAt(
          segment.offset +
            textDocument.offsetAt({
              line: info.start.line,
              character: info.start.character,
            })
        );
        const endPos = textDocument.positionAt(
          segment.offset +
            textDocument.offsetAt({
              line: info.end.line,
              character: info.end.character,
            })
        );

        allDiagnostics.push({
          range: { start: startPos, end: endPos },
          message: info.message,
          severity: info.severity as DiagnosticSeverity,
          code: info.code,
          source: info.source,
        });
      }
    }

    connection.sendDiagnostics({
      uri: textDocument.uri,
      diagnostics: allDiagnostics,
    });
  } catch (error) {
    connection.console.error(`MoZuku: Analysis error: ${error}`);
  }
}

/**
 * Handle hover requests with Wikipedia integration
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
      if (
        offset >= token.offset &&
        offset < token.offset + token.surface.length
      ) {
        const hoverLines = [
          `**${token.surface}**`,
          '',
          '| 項目 | 値 |',
          '|------|------|',
          `| 品詞 | ${token.pos} |`,
          `| 品詞細分類1 | ${token.posDetail1} |`,
          `| 品詞細分類2 | ${token.posDetail2} |`,
          `| 品詞細分類3 | ${token.posDetail3} |`,
          `| 活用型 | ${token.conjugationType} |`,
          `| 活用形 | ${token.conjugationForm} |`,
          `| 基本形 | ${token.baseForm} |`,
          `| 読み | ${token.reading} |`,
          `| 発音 | ${token.pronunciation} |`,
        ];

        // Add Wikipedia summary for nouns
        if (config.enableWikipedia && token.pos === '名詞' && token.baseForm) {
          try {
            const summary = await fetchWikipediaSummary(token.baseForm);
            if (summary) {
              hoverLines.push('', '---', '', '**Wikipedia**', '', summary);
            }
          } catch {
            // Ignore Wikipedia errors
          }
        }

        return {
          contents: {
            kind: 'markdown',
            value: hoverLines.join('\n'),
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
 * Handle semantic tokens request (full document)
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
  const languageId = document.languageId;

  try {
    const builder = new SemanticTokensBuilder();
    const segments = getAnalyzableText(text, languageId);

    for (const segment of segments) {
      const japaneseRatio = calculateJapaneseRatio(segment.text);
      if (japaneseRatio < config.minJapaneseRatio) {
        continue;
      }

      const { tokens } = analyze(segment.text);

      for (const token of tokens) {
        // Calculate position in original document
        const absoluteOffset = segment.offset + token.offset;
        const pos = document.positionAt(absoluteOffset);
        const tokenType = posToTokenType(token.pos);
        const tokenModifier = computeModifierMask(token);

        builder.push(
          pos.line,
          pos.character,
          token.surface.length,
          tokenType,
          tokenModifier
        );
      }
    }

    return builder.build();
  } catch (error) {
    connection.console.error(`MoZuku: Semantic tokens error: ${error}`);
    return { data: [] };
  }
});

/**
 * Handle semantic tokens range request
 */
connection.languages.semanticTokens.onRange(async (params) => {
  // For range requests, we still analyze the full document for simplicity
  // A more optimized implementation would only analyze the requested range
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
  const languageId = document.languageId;

  try {
    const builder = new SemanticTokensBuilder();
    const segments = getAnalyzableText(text, languageId);

    for (const segment of segments) {
      const japaneseRatio = calculateJapaneseRatio(segment.text);
      if (japaneseRatio < config.minJapaneseRatio) {
        continue;
      }

      const { tokens } = analyze(segment.text);

      for (const token of tokens) {
        const absoluteOffset = segment.offset + token.offset;
        const pos = document.positionAt(absoluteOffset);
        const tokenType = posToTokenType(token.pos);
        const tokenModifier = computeModifierMask(token);

        builder.push(
          pos.line,
          pos.character,
          token.surface.length,
          tokenType,
          tokenModifier
        );
      }
    }

    return builder.build();
  } catch (error) {
    connection.console.error(`MoZuku: Semantic tokens range error: ${error}`);
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
