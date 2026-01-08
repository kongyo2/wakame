/**
 * Japanese text analyzer using kuromoji
 * With Tree-sitter based AST analysis for high-precision comment extraction
 */

import kuromoji from 'kuromoji';
import * as path from 'path';
import type {
  Token,
  Sentence,
  AnalysisResult,
  TokenModifiers,
  CommentRange,
} from '../shared/types.js';

// Re-export Tree-sitter functions
export {
  initializeTreeSitter,
  extractCommentsWithTreeSitter,
  extractHtmlContentWithTreeSitter,
  isTreeSitterReady,
  isLanguageSupported,
  getSupportedLanguages,
} from './treeSitterExtractor.js';

type KuromojiToken = kuromoji.IpadicFeatures;
type Tokenizer = kuromoji.Tokenizer<KuromojiToken>;

let tokenizer: Tokenizer | null = null;
let initPromise: Promise<Tokenizer> | null = null;

// Character type detection regexes
const HIRAGANA_REGEX = /[\u3040-\u309F]/;
const KATAKANA_REGEX = /[\u30A0-\u30FF]/;
const KANJI_REGEX = /[\u4E00-\u9FFF]/;
const JAPANESE_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3000-\u303F]/g;

/**
 * Get the path to kuromoji dictionary
 * In production, this is bundled with the extension
 */
function getDictionaryPath(): string {
  const fs = require('fs');

  // Try bundled dictionary first (relative to dist/server/server.js -> dict/)
  const bundledPath = path.join(__dirname, '..', '..', 'dict');
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  // Fallback to node_modules during development
  const devPath = path.join(
    __dirname,
    '..',
    '..',
    'node_modules',
    'kuromoji',
    'dict'
  );
  if (fs.existsSync(devPath)) {
    return devPath;
  }

  // Last resort: check current working directory
  const cwdPath = path.resolve(process.cwd(), 'node_modules', 'kuromoji', 'dict');
  return cwdPath;
}

/**
 * Initialize the kuromoji tokenizer
 */
export async function initializeTokenizer(): Promise<void> {
  if (tokenizer) {
    return;
  }

  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = new Promise<Tokenizer>((resolve, reject) => {
    const dicPath = getDictionaryPath();
    kuromoji.builder({ dicPath }).build((err, builtTokenizer) => {
      if (err) {
        reject(err);
        return;
      }
      tokenizer = builtTokenizer;
      resolve(builtTokenizer);
    });
  });

  await initPromise;
}

/**
 * Compute token modifiers based on POS and surface form
 */
function computeModifiers(kt: KuromojiToken): TokenModifiers {
  const surface = kt.surface_form;

  // Check if proper noun (固有名詞)
  const proper = kt.pos_detail_1 === '固有名詞';

  // Check if numeric (数)
  const numeric =
    kt.pos_detail_1 === '数' ||
    kt.pos_detail_2 === '数' ||
    /^[0-9０-９]+$/.test(surface);

  // Check character types
  const kana = HIRAGANA_REGEX.test(surface) || KATAKANA_REGEX.test(surface);
  const kanji = KANJI_REGEX.test(surface);

  return { proper, numeric, kana, kanji };
}

/**
 * Tokenize Japanese text
 */
export function tokenize(text: string): Token[] {
  if (!tokenizer) {
    throw new Error(
      'Tokenizer not initialized. Call initializeTokenizer() first.'
    );
  }

  const kuromojiTokens = tokenizer.tokenize(text);
  const tokens: Token[] = [];

  let currentOffset = 0;

  for (const kt of kuromojiTokens) {
    // Find the position of this token in the original text
    const tokenStart = text.indexOf(kt.surface_form, currentOffset);
    const offset = tokenStart >= 0 ? tokenStart : currentOffset;

    tokens.push({
      surface: kt.surface_form,
      pos: kt.pos ?? '*',
      posDetail1: kt.pos_detail_1 ?? '*',
      posDetail2: kt.pos_detail_2 ?? '*',
      posDetail3: kt.pos_detail_3 ?? '*',
      conjugationType: kt.conjugated_type ?? '*',
      conjugationForm: kt.conjugated_form ?? '*',
      baseForm: kt.basic_form ?? kt.surface_form,
      reading: kt.reading ?? '',
      pronunciation: kt.pronunciation ?? '',
      offset,
      length: Buffer.byteLength(kt.surface_form, 'utf-8'),
      modifiers: computeModifiers(kt),
    });

    currentOffset = offset + kt.surface_form.length;
  }

  return tokens;
}

/**
 * Split text into sentences based on Japanese punctuation
 */
export function splitSentences(text: string, tokens: Token[]): Sentence[] {
  const sentences: Sentence[] = [];
  const sentenceEnders = ['。', '！', '？', '!', '?', '\n'];

  let currentStart = 0;
  let currentTokens: Token[] = [];

  for (const token of tokens) {
    currentTokens.push(token);

    // Check if this token ends a sentence
    const isSentenceEnd =
      sentenceEnders.includes(token.surface) ||
      (token.pos === '記号' && sentenceEnders.includes(token.surface));

    if (isSentenceEnd) {
      const sentenceEnd = token.offset + token.surface.length;
      const sentenceText = text.slice(currentStart, sentenceEnd);

      sentences.push({
        text: sentenceText,
        start: currentStart,
        end: sentenceEnd,
        tokens: currentTokens,
      });

      currentStart = sentenceEnd;
      currentTokens = [];
    }
  }

  // Handle remaining text as final sentence
  if (currentTokens.length > 0) {
    const lastToken = currentTokens[currentTokens.length - 1];
    const sentenceEnd = lastToken.offset + lastToken.surface.length;
    const sentenceText = text.slice(currentStart, sentenceEnd);

    sentences.push({
      text: sentenceText,
      start: currentStart,
      end: sentenceEnd,
      tokens: currentTokens,
    });
  }

  return sentences;
}

/**
 * Analyze text and return tokens and sentences
 */
export function analyze(text: string): AnalysisResult {
  const tokens = tokenize(text);
  const sentences = splitSentences(text, tokens);

  return { tokens, sentences };
}

/**
 * Calculate the ratio of Japanese characters in text
 */
export function calculateJapaneseRatio(text: string): number {
  if (text.length === 0) return 0;

  const matches = text.match(JAPANESE_REGEX) || [];
  return matches.length / text.length;
}

/**
 * Check if tokenizer is ready
 */
export function isTokenizerReady(): boolean {
  return tokenizer !== null;
}

/**
 * Extract comments from source code based on language
 */
export function extractComments(text: string, languageId: string): CommentRange[] {
  const comments: CommentRange[] = [];

  // Define comment patterns for each language
  const patterns: Record<string, RegExp[]> = {
    javascript: [/\/\/(.*)$/gm, /\/\*[\s\S]*?\*\//g],
    typescript: [/\/\/(.*)$/gm, /\/\*[\s\S]*?\*\//g],
    javascriptreact: [/\/\/(.*)$/gm, /\/\*[\s\S]*?\*\//g],
    typescriptreact: [/\/\/(.*)$/gm, /\/\*[\s\S]*?\*\//g],
    python: [/#(.*)$/gm, /'''[\s\S]*?'''/g, /"""[\s\S]*?"""/g],
    rust: [/\/\/(.*)$/gm, /\/\*[\s\S]*?\*\//g],
    c: [/\/\/(.*)$/gm, /\/\*[\s\S]*?\*\//g],
    cpp: [/\/\/(.*)$/gm, /\/\*[\s\S]*?\*\//g],
    html: [/<!--[\s\S]*?-->/g],
    latex: [/%(.*)$/gm],
  };

  const langPatterns = patterns[languageId];
  if (!langPatterns) {
    return comments;
  }

  for (const pattern of langPatterns) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(text)) !== null) {
      const original = match[0];
      // Remove comment markers
      let extracted = original
        .replace(/^\/\/\s*/, '')
        .replace(/^\/\*\s*/, '')
        .replace(/\s*\*\/$/, '')
        .replace(/^#\s*/, '')
        .replace(/^%\s*/, '')
        .replace(/^<!--\s*/, '')
        .replace(/\s*-->$/, '')
        .replace(/^'''\s*/, '')
        .replace(/\s*'''$/, '')
        .replace(/^"""\s*/, '')
        .replace(/\s*"""$/, '');

      // Only include if it contains Japanese characters
      if (calculateJapaneseRatio(extracted) > 0.1) {
        comments.push({
          start: match.index,
          end: match.index + original.length,
          text: extracted,
          original,
        });
      }
    }
  }

  return comments;
}

/**
 * Extract text content from HTML (text inside tags)
 */
export function extractHtmlContent(text: string): CommentRange[] {
  const contents: CommentRange[] = [];
  // Match text between tags, excluding script and style content
  const tagPattern = />([^<]+)</g;
  let match;

  while ((match = tagPattern.exec(text)) !== null) {
    const content = match[1].trim();
    if (content && calculateJapaneseRatio(content) > 0.1) {
      contents.push({
        start: match.index + 1,
        end: match.index + 1 + match[1].length,
        text: content,
        original: match[1],
      });
    }
  }

  return contents;
}

/**
 * Extract text content from LaTeX (text outside commands and math)
 */
export function extractLatexContent(text: string): CommentRange[] {
  const contents: CommentRange[] = [];
  // Simple pattern: text that's not a command or in math mode
  // This is a simplified version - real LaTeX parsing would be more complex
  const textPattern = /(?:^|[^\\])([^\\$%{}]+)/gm;
  let match;

  while ((match = textPattern.exec(text)) !== null) {
    const content = match[1]?.trim();
    if (content && calculateJapaneseRatio(content) > 0.1) {
      const startOffset = match.index + (match[0].length - match[1].length);
      contents.push({
        start: startOffset,
        end: startOffset + match[1].length,
        text: content,
        original: match[1],
      });
    }
  }

  return contents;
}
