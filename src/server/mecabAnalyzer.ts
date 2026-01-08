/**
 * MeCab WASM wrapper for Node.js LSP environment
 * Provides high-accuracy Japanese morphological analysis using MeCab with IPADIC dictionary
 */

import * as path from 'path';
import * as fs from 'fs';

// MeCab token interface matching the mecab-wasm output format
export interface MecabToken {
  word: string;
  pos: string;
  pos_detail1: string;
  pos_detail2: string;
  pos_detail3: string;
  conjugation1: string;
  conjugation2: string;
  dictionary_form: string;
  reading: string;
  pronunciation: string;
}

// Dynamic import type for mecab-wasm
type MecabClass = {
  waitReady(): Promise<void>;
  query(text: string): MecabToken[];
};

let mecabInstance: MecabClass | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Get the path to mecab-wasm library files
 * In production, this is bundled with the extension
 */
function getMecabLibPath(): string {
  // Try bundled path first (relative to dist/server/server.js -> wasm/)
  const bundledPath = path.join(__dirname, '..', 'wasm');
  if (fs.existsSync(path.join(bundledPath, 'libmecab.wasm'))) {
    return bundledPath;
  }

  // Fallback to node_modules during development
  const devPath = path.join(
    __dirname,
    '..',
    '..',
    'node_modules',
    'mecab-wasm',
    'lib'
  );
  if (fs.existsSync(path.join(devPath, 'libmecab.wasm'))) {
    return devPath;
  }

  // Last resort: check current working directory
  const cwdPath = path.resolve(process.cwd(), 'node_modules', 'mecab-wasm', 'lib');
  return cwdPath;
}

/**
 * Initialize MeCab WASM module
 * Must be called before using mecabTokenize()
 */
export async function initializeMecab(): Promise<void> {
  if (mecabInstance) {
    return;
  }

  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    try {
      // Dynamic import for ESM module
      const mecabPath = getMecabLibPath();
      console.log(`[Wakame] Loading MeCab from: ${mecabPath}`);

      // Import the mecab-wasm module
      const MecabModule = await import('mecab-wasm');
      const Mecab = MecabModule.default as MecabClass;

      // Wait for WASM initialization
      await Mecab.waitReady();
      mecabInstance = Mecab;

      console.log('[Wakame] MeCab WASM initialized successfully');
    } catch (error) {
      console.error('[Wakame] Failed to initialize MeCab:', error);
      throw error;
    }
  })();

  await initPromise;
}

/**
 * Tokenize Japanese text using MeCab
 * @param text - Japanese text to tokenize
 * @returns Array of MeCab tokens with morphological information
 */
export function mecabTokenize(text: string): MecabToken[] {
  if (!mecabInstance) {
    throw new Error('MeCab not initialized. Call initializeMecab() first.');
  }

  try {
    return mecabInstance.query(text);
  } catch (error) {
    console.error('[Wakame] MeCab tokenization error:', error);
    return [];
  }
}

/**
 * Check if MeCab is ready for use
 */
export function isMecabReady(): boolean {
  return mecabInstance !== null;
}
