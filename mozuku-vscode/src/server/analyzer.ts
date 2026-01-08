/**
 * Japanese text analyzer using kuromoji
 */

import kuromoji from 'kuromoji';
import * as path from 'path';
import type { Token, Sentence, AnalysisResult } from '../shared/types.js';

type KuromojiToken = kuromoji.IpadicFeatures;
type Tokenizer = kuromoji.Tokenizer<KuromojiToken>;

let tokenizer: Tokenizer | null = null;
let initPromise: Promise<Tokenizer> | null = null;

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
  const devPath = path.join(__dirname, '..', '..', 'node_modules', 'kuromoji', 'dict');
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
 * Tokenize Japanese text
 */
export function tokenize(text: string): Token[] {
  if (!tokenizer) {
    throw new Error('Tokenizer not initialized. Call initializeTokenizer() first.');
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

  // Japanese character ranges:
  // Hiragana: 3040-309F
  // Katakana: 30A0-30FF
  // CJK Unified Ideographs: 4E00-9FFF
  // Fullwidth punctuation: 3000-303F
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3000-\u303F]/g;
  const matches = text.match(japaneseRegex) || [];

  return matches.length / text.length;
}

/**
 * Check if tokenizer is ready
 */
export function isTokenizerReady(): boolean {
  return tokenizer !== null;
}
