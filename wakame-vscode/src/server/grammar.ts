/**
 * Grammar checking rules for Japanese text
 * Inspired by MoZuku (https://github.com/t3tra-dev/MoZuku)
 */

import type { Token, Sentence, DiagnosticInfo, WakameConfig } from '../shared/types.js';

/**
 * Convert byte offset to line/character position
 */
function offsetToPosition(
  text: string,
  offset: number
): { line: number; character: number } {
  let line = 0;
  let character = 0;
  let currentOffset = 0;

  for (const char of text) {
    if (currentOffset >= offset) break;

    if (char === '\n') {
      line++;
      character = 0;
    } else {
      character++;
    }
    currentOffset += char.length;
  }

  return { line, character };
}

/**
 * Check if token is a particle (助詞)
 */
function isParticle(token: Token): boolean {
  return token.pos === '助詞';
}

/**
 * Check if token is an adversative "ga" (逆接の接続助詞「が」)
 */
function isAdversativeGa(token: Token): boolean {
  return (
    token.pos === '助詞' &&
    token.posDetail1 === '接続助詞' &&
    token.baseForm === 'が'
  );
}

/**
 * Check if token is a conjunction (接続詞)
 */
function isConjunction(token: Token): boolean {
  return token.pos === '接続詞';
}

/**
 * Get particle key for comparison (POS + detail1)
 */
function getParticleKey(token: Token): string {
  return `${token.pos},${token.posDetail1}`;
}

/**
 * Check if token is a target verb for ra-dropping check
 * (一段動詞・自立・未然形)
 */
function isTargetVerb(token: Token): boolean {
  return (
    token.pos === '動詞' &&
    token.posDetail1 === '自立' &&
    token.conjugationType === '一段' &&
    token.conjugationForm === '未然形'
  );
}

/**
 * Check if token is the "reru" suffix (接尾「れる」)
 */
function isRaWord(token: Token): boolean {
  return (
    token.pos === '動詞' &&
    token.posDetail1 === '接尾' &&
    token.baseForm === 'れる'
  );
}

/**
 * Check if token is a special ra-dropping case (来れる/見れる)
 */
function isSpecialRaCase(token: Token): boolean {
  return (
    token.pos === '動詞' &&
    (token.baseForm === '来れる' || token.baseForm === '見れる')
  );
}

/**
 * Count commas (読点「、」) in text
 */
function countCommas(text: string): number {
  return (text.match(/、/g) || []).length;
}

/**
 * Check comma limit rule
 * 一文で使用できる読点「、」を制限する
 */
function checkCommaLimit(
  text: string,
  sentences: Sentence[],
  config: WakameConfig
): DiagnosticInfo[] {
  if (!config.rules.commaLimit) return [];

  const diagnostics: DiagnosticInfo[] = [];
  const limit = config.rules.commaLimitMax;

  for (const sentence of sentences) {
    const commaCount = countCommas(sentence.text);
    if (commaCount > limit) {
      diagnostics.push({
        start: offsetToPosition(text, sentence.start),
        end: offsetToPosition(text, sentence.end),
        message: `一文に使用できる読点「、」は最大${limit}個までです (現在${commaCount}個)`,
        severity: 2,
        code: 'comma-limit',
        source: 'wakame',
      });
    }
  }

  return diagnostics;
}

/**
 * Check adversative "ga" rule
 * 逆接の接続助詞「が」が同一文で複数回出現する場合に警告
 */
function checkAdversativeGa(
  text: string,
  sentences: Sentence[],
  config: WakameConfig
): DiagnosticInfo[] {
  if (!config.rules.adversativeGa) return [];

  const diagnostics: DiagnosticInfo[] = [];
  const maxCount = config.rules.adversativeGaMax;

  for (const sentence of sentences) {
    let count = 0;
    for (const token of sentence.tokens) {
      if (isAdversativeGa(token)) {
        count++;
      }
    }

    if (count > maxCount) {
      diagnostics.push({
        start: offsetToPosition(text, sentence.start),
        end: offsetToPosition(text, sentence.end),
        message: `逆接の接続助詞「が」が同一文で${maxCount + 1}回以上使われています (${count}回)`,
        severity: 2,
        code: 'adversative-ga',
        source: 'wakame',
      });
    }
  }

  return diagnostics;
}

/**
 * Check duplicate particle surface rule
 * 同じ助詞が連続する場合に警告
 */
function checkDuplicateParticle(
  text: string,
  sentences: Sentence[],
  config: WakameConfig
): DiagnosticInfo[] {
  if (!config.rules.duplicateParticle) return [];

  const diagnostics: DiagnosticInfo[] = [];

  for (const sentence of sentences) {
    let lastSurface = '';
    let lastKey = '';
    let lastToken: Token | null = null;
    let streak = 1;

    for (const token of sentence.tokens) {
      if (!isParticle(token)) continue;

      const currentKey = getParticleKey(token);

      if (lastToken && token.surface === lastSurface && currentKey === lastKey) {
        streak++;
        if (streak > 1) {
          const startOffset = lastToken.offset;
          const endOffset = token.offset + token.surface.length;
          diagnostics.push({
            start: offsetToPosition(text, startOffset),
            end: offsetToPosition(text, endOffset),
            message: `同じ助詞「${token.surface}」が連続しています`,
            severity: 2,
            code: 'duplicate-particle',
            source: 'wakame',
          });
        }
      } else {
        streak = 1;
      }

      lastSurface = token.surface;
      lastKey = currentKey;
      lastToken = token;
    }
  }

  return diagnostics;
}

/**
 * Check adjacent particles rule
 * 助詞が隣接して連続する場合に警告
 */
function checkAdjacentParticles(
  text: string,
  sentences: Sentence[],
  config: WakameConfig
): DiagnosticInfo[] {
  if (!config.rules.adjacentParticles) return [];

  const diagnostics: DiagnosticInfo[] = [];

  for (const sentence of sentences) {
    let prevIsParticle = false;
    let prevKey = '';
    let prevToken: Token | null = null;
    let streak = 1;

    for (const token of sentence.tokens) {
      const currentIsParticle = isParticle(token);
      const currentKey = getParticleKey(token);

      // Check if adjacent (no gap between tokens)
      const isAdjacent =
        prevToken &&
        token.offset === prevToken.offset + prevToken.surface.length;

      if (currentIsParticle && prevIsParticle && currentKey === prevKey && isAdjacent) {
        streak++;
        if (streak > 1 && prevToken) {
          const startOffset = prevToken.offset;
          const endOffset = token.offset + token.surface.length;
          diagnostics.push({
            start: offsetToPosition(text, startOffset),
            end: offsetToPosition(text, endOffset),
            message: '助詞が連続して使われています',
            severity: 2,
            code: 'adjacent-particles',
            source: 'wakame',
          });
        }
      } else {
        streak = 1;
      }

      prevIsParticle = currentIsParticle;
      if (currentIsParticle) {
        prevToken = token;
        prevKey = currentKey;
      }
    }
  }

  return diagnostics;
}

/**
 * Check conjunction repeat rule
 * 同じ接続詞が連続する場合に警告 (改行でリセット)
 */
function checkConjunctionRepeat(
  text: string,
  sentences: Sentence[],
  config: WakameConfig
): DiagnosticInfo[] {
  if (!config.rules.conjunctionRepeat) return [];

  const diagnostics: DiagnosticInfo[] = [];

  // Flatten all tokens from all sentences
  const allTokens: Token[] = [];
  for (const sentence of sentences) {
    allTokens.push(...sentence.tokens);
  }

  let lastSurface = '';
  let lastToken: Token | null = null;
  let streak = 1;

  for (const token of allTokens) {
    if (!isConjunction(token)) continue;

    // Check if separated by newline
    const separatedByNewline =
      lastToken &&
      text.slice(lastToken.offset + lastToken.surface.length, token.offset).includes('\n');

    if (lastToken && token.surface === lastSurface && !separatedByNewline) {
      streak++;
      if (streak > 1) {
        const startOffset = lastToken.offset;
        const endOffset = token.offset + token.surface.length;
        diagnostics.push({
          start: offsetToPosition(text, startOffset),
          end: offsetToPosition(text, endOffset),
          message: `同じ接続詞「${token.surface}」が連続しています`,
          severity: 2,
          code: 'conjunction-repeat',
          source: 'wakame',
        });
      }
    } else {
      streak = 1;
    }

    lastSurface = token.surface;
    lastToken = token;
  }

  return diagnostics;
}

/**
 * Check ra-dropping rule
 * ら抜き言葉を検出する
 */
function checkRaDropping(
  text: string,
  sentences: Sentence[],
  config: WakameConfig
): DiagnosticInfo[] {
  if (!config.rules.raDropping) return [];

  const diagnostics: DiagnosticInfo[] = [];
  const message = 'ら抜き言葉を使用しています';

  for (const sentence of sentences) {
    // Check special cases (来れる/見れる as single token)
    for (const token of sentence.tokens) {
      if (isSpecialRaCase(token)) {
        diagnostics.push({
          start: offsetToPosition(text, token.offset),
          end: offsetToPosition(text, token.offset + token.surface.length),
          message,
          severity: 2,
          code: 'ra-dropping',
          source: 'wakame',
        });
      }
    }

    // Check 2-token combinations (verb in 未然形 + 接尾「れる」)
    let prevToken: Token | null = null;

    for (const token of sentence.tokens) {
      if (prevToken && isTargetVerb(prevToken) && isRaWord(token)) {
        const startOffset = prevToken.offset;
        const endOffset = token.offset + token.surface.length;
        diagnostics.push({
          start: offsetToPosition(text, startOffset),
          end: offsetToPosition(text, endOffset),
          message,
          severity: 2,
          code: 'ra-dropping',
          source: 'wakame',
        });
      }
      prevToken = token;
    }
  }

  return diagnostics;
}

/**
 * Run all grammar checks and return diagnostics
 */
export function checkGrammar(
  text: string,
  sentences: Sentence[],
  config: WakameConfig
): DiagnosticInfo[] {
  const diagnostics: DiagnosticInfo[] = [];

  diagnostics.push(...checkCommaLimit(text, sentences, config));
  diagnostics.push(...checkAdversativeGa(text, sentences, config));
  diagnostics.push(...checkDuplicateParticle(text, sentences, config));
  diagnostics.push(...checkAdjacentParticles(text, sentences, config));
  diagnostics.push(...checkConjunctionRepeat(text, sentences, config));
  diagnostics.push(...checkRaDropping(text, sentences, config));

  return diagnostics;
}
