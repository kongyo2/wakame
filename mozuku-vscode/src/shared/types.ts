/**
 * MoZuku shared type definitions
 */

export interface Token {
  /** Surface form (表層形) */
  surface: string;
  /** Part of speech (品詞) */
  pos: string;
  /** POS detail 1 (品詞細分類1) */
  posDetail1: string;
  /** POS detail 2 (品詞細分類2) */
  posDetail2: string;
  /** POS detail 3 (品詞細分類3) */
  posDetail3: string;
  /** Conjugation type (活用型) */
  conjugationType: string;
  /** Conjugation form (活用形) */
  conjugationForm: string;
  /** Base form (原形/基本形) */
  baseForm: string;
  /** Reading (読み) */
  reading: string;
  /** Pronunciation (発音) */
  pronunciation: string;
  /** Byte offset in original text */
  offset: number;
  /** Length in bytes */
  length: number;
}

export interface Sentence {
  /** Sentence text */
  text: string;
  /** Start offset in document */
  start: number;
  /** End offset in document */
  end: number;
  /** Tokens in this sentence */
  tokens: Token[];
}

export interface AnalysisResult {
  /** All tokens in the document */
  tokens: Token[];
  /** Sentence boundaries */
  sentences: Sentence[];
}

export interface DiagnosticInfo {
  /** Start position (line, character) */
  start: { line: number; character: number };
  /** End position (line, character) */
  end: { line: number; character: number };
  /** Diagnostic message */
  message: string;
  /** Severity: 1 = Error, 2 = Warning, 3 = Information, 4 = Hint */
  severity: 1 | 2 | 3 | 4;
  /** Rule code */
  code: string;
  /** Source identifier */
  source: string;
}

export interface MozukuConfig {
  enable: boolean;
  targetLanguages: string[];
  minJapaneseRatio: number;
  rules: {
    commaLimit: boolean;
    commaLimitMax: number;
    adversativeGa: boolean;
    adversativeGaMax: number;
    duplicateParticle: boolean;
    adjacentParticles: boolean;
    conjunctionRepeat: boolean;
    raDropping: boolean;
  };
}

export const defaultConfig: MozukuConfig = {
  enable: true,
  targetLanguages: ['plaintext', 'markdown', 'japanese', 'latex', 'html'],
  minJapaneseRatio: 0.1,
  rules: {
    commaLimit: true,
    commaLimitMax: 3,
    adversativeGa: true,
    adversativeGaMax: 1,
    duplicateParticle: true,
    adjacentParticles: true,
    conjunctionRepeat: true,
    raDropping: true,
  },
};
