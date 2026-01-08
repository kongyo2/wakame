/**
 * Japanese text analyzer using MeCab WASM
 * With Tree-sitter based AST analysis for high-precision comment extraction
 */

import type {
  Token,
  Sentence,
  AnalysisResult,
  TokenModifiers,
  CommentRange,
} from '../shared/types.js';
import {
  initializeMecab,
  mecabTokenize,
  isMecabReady,
  type MecabToken,
} from './mecabAnalyzer.js';

// Re-export Tree-sitter functions
export {
  initializeTreeSitter,
  extractCommentsWithTreeSitter,
  extractHtmlContentWithTreeSitter,
  isTreeSitterReady,
  isLanguageSupported,
  getSupportedLanguages,
} from './treeSitterExtractor.js';

// Character type detection regexes
const HIRAGANA_REGEX = /[\u3040-\u309F]/;
const KATAKANA_REGEX = /[\u30A0-\u30FF]/;
const KANJI_REGEX = /[\u4E00-\u9FFF]/;
const JAPANESE_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3000-\u303F]/g;

/**
 * Initialize the MeCab tokenizer
 */
export async function initializeTokenizer(): Promise<void> {
  await initializeMecab();
}

/**
 * Compute token modifiers based on POS and surface form
 */
function computeModifiers(mt: MecabToken): TokenModifiers {
  const surface = mt.word;

  // Check if proper noun (固有名詞)
  const proper = mt.pos_detail1 === '固有名詞';

  // Check if numeric (数)
  const numeric =
    mt.pos_detail1 === '数' ||
    mt.pos_detail2 === '数' ||
    /^[0-9０-９]+$/.test(surface);

  // Check character types
  const kana = HIRAGANA_REGEX.test(surface) || KATAKANA_REGEX.test(surface);
  const kanji = KANJI_REGEX.test(surface);

  return { proper, numeric, kana, kanji };
}

/**
 * Tokenize Japanese text using MeCab
 */
export function tokenize(text: string): Token[] {
  if (!isMecabReady()) {
    throw new Error(
      'Tokenizer not initialized. Call initializeTokenizer() first.'
    );
  }

  const mecabTokens = mecabTokenize(text);
  const tokens: Token[] = [];

  let currentOffset = 0;

  for (const mt of mecabTokens) {
    // Find the position of this token in the original text
    const tokenStart = text.indexOf(mt.word, currentOffset);
    const offset = tokenStart >= 0 ? tokenStart : currentOffset;

    tokens.push({
      surface: mt.word,
      pos: mt.pos ?? '*',
      posDetail1: mt.pos_detail1 ?? '*',
      posDetail2: mt.pos_detail2 ?? '*',
      posDetail3: mt.pos_detail3 ?? '*',
      conjugationType: mt.conjugation1 ?? '*',
      conjugationForm: mt.conjugation2 ?? '*',
      baseForm: mt.dictionary_form ?? mt.word,
      reading: mt.reading ?? '',
      pronunciation: mt.pronunciation ?? '',
      offset,
      length: Buffer.byteLength(mt.word, 'utf-8'),
      modifiers: computeModifiers(mt),
    });

    currentOffset = offset + mt.word.length;
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
  return isMecabReady();
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
