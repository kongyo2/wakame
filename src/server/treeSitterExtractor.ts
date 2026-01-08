/**
 * Tree-sitter based comment extractor for high-precision AST analysis
 * Inspired by MoZuku's CommentExtractor implementation
 */

import * as path from 'path';
import * as fs from 'fs';
import type { CommentRange } from '../shared/types.js';

// Dynamic import for web-tree-sitter (ESM package in CJS context)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Parser: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let parserInstance: any = null;

// Language cache
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const languageCache = new Map<string, any>();

// Initialization promise
let initPromise: Promise<void> | null = null;

// Language ID to grammar name mapping
const languageGrammarMap: Record<string, string> = {
    javascript: 'tree-sitter-javascript',
    javascriptreact: 'tree-sitter-javascript',
    typescript: 'tree-sitter-typescript',
    typescriptreact: 'tree-sitter-tsx',
    python: 'tree-sitter-python',
    c: 'tree-sitter-c',
    cpp: 'tree-sitter-c', // C grammar works for basic C++ comments
    html: 'tree-sitter-html',
};

// Comment node types for each language
const commentNodeTypes: Record<string, string[]> = {
    javascript: ['comment', 'line_comment', 'block_comment'],
    javascriptreact: ['comment', 'line_comment', 'block_comment'],
    typescript: ['comment', 'line_comment', 'block_comment'],
    typescriptreact: ['comment', 'line_comment', 'block_comment'],
    python: ['comment', 'string'], // Include docstrings
    c: ['comment'],
    cpp: ['comment'],
    html: ['comment'],
};

/**
 * Get the path to WASM files
 */
function getWasmBasePath(): string {
    // Try bundled path first (dist/server/wasm/)
    const bundledPath = path.join(__dirname, '..', '..', 'wasm');
    if (fs.existsSync(bundledPath)) {
        return bundledPath;
    }

    // Fallback to node_modules during development
    return path.join(__dirname, '..', '..', 'node_modules');
}

/**
 * Get WASM file path for a grammar
 */
function getGrammarWasmPath(grammarName: string): string {
    const basePath = getWasmBasePath();

    // Check bundled location first
    const bundledWasm = path.join(basePath, `${grammarName}.wasm`);
    if (fs.existsSync(bundledWasm)) {
        return bundledWasm;
    }

    // Fallback to node_modules structure
    const nodeModulesPath = path.join(basePath, grammarName, `${grammarName}.wasm`);
    if (fs.existsSync(nodeModulesPath)) {
        return nodeModulesPath;
    }

    // Special case for TSX
    if (grammarName === 'tree-sitter-tsx') {
        const tsxPath = path.join(basePath, 'tree-sitter-typescript', 'tree-sitter-tsx.wasm');
        if (fs.existsSync(tsxPath)) {
            return tsxPath;
        }
    }

    throw new Error(`WASM file not found for grammar: ${grammarName}`);
}

/**
 * Initialize Tree-sitter parser
 */
export async function initializeTreeSitter(): Promise<void> {
    if (parserInstance) {
        return;
    }

    if (initPromise) {
        await initPromise;
        return;
    }

    initPromise = (async () => {
        // Dynamic import of web-tree-sitter
        const treeSitterModule = await import('web-tree-sitter');
        Parser = treeSitterModule.default;

        const basePath = getWasmBasePath();
        const treeSitterWasm = path.join(basePath, 'web-tree-sitter', 'web-tree-sitter.wasm');

        // Check bundled location
        const bundledTreeSitterWasm = path.join(basePath, 'web-tree-sitter.wasm');
        const wasmPath = fs.existsSync(bundledTreeSitterWasm)
            ? bundledTreeSitterWasm
            : treeSitterWasm;

        await Parser.init({
            locateFile: () => wasmPath,
        });
        parserInstance = new Parser();
    })();

    await initPromise;
}

/**
 * Load a language grammar
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadLanguage(languageId: string): Promise<any | null> {
    const grammarName = languageGrammarMap[languageId];
    if (!grammarName) {
        return null;
    }

    // Check cache
    if (languageCache.has(grammarName)) {
        return languageCache.get(grammarName)!;
    }

    try {
        const wasmPath = getGrammarWasmPath(grammarName);
        const language = await Parser.Language.load(wasmPath);
        languageCache.set(grammarName, language);
        return language;
    } catch {
        console.error(`Failed to load Tree-sitter grammar for: ${languageId}`);
        return null;
    }
}

/**
 * Check if a node type is a comment type for the given language
 */
function isCommentNode(nodeType: string, languageId: string): boolean {
    const types = commentNodeTypes[languageId] || [];

    // Check direct match
    if (types.includes(nodeType)) {
        return true;
    }

    // Check if node type contains 'comment'
    if (nodeType.toLowerCase().includes('comment')) {
        return true;
    }

    return false;
}

/**
 * Check if a Python node is a docstring (triple-quoted string at specific positions)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isPythonDocstring(node: any): boolean {
    if (node.type !== 'string' && node.type !== 'string_content') {
        return false;
    }

    const text = node.text;
    // Check if triple-quoted
    return text.startsWith('"""') || text.startsWith("'''");
}

/**
 * Sanitize comment text by removing comment markers
 */
function sanitizeComment(text: string, languageId: string): string {
    let sanitized = text;

    switch (languageId) {
        case 'javascript':
        case 'javascriptreact':
        case 'typescript':
        case 'typescriptreact':
        case 'c':
        case 'cpp':
            // Remove // prefix
            sanitized = sanitized.replace(/^\/\/\s*/, '');
            // Remove /* */ markers
            sanitized = sanitized.replace(/^\/\*\s*/, '').replace(/\s*\*\/$/, '');
            // Remove * at line starts (for multi-line comments)
            sanitized = sanitized.replace(/^\s*\*\s?/gm, '');
            break;

        case 'python':
            // Remove # prefix
            sanitized = sanitized.replace(/^#\s*/, '');
            // Remove triple quotes
            sanitized = sanitized.replace(/^('''|""")\s*/, '').replace(/\s*('''|""")$/, '');
            break;

        case 'html':
            // Remove <!-- --> markers
            sanitized = sanitized.replace(/^<!--\s*/, '').replace(/\s*-->$/, '');
            break;
    }

    return sanitized.trim();
}

/**
 * Calculate Japanese character ratio
 */
function calculateJapaneseRatio(text: string): number {
    if (text.length === 0) return 0;
    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3000-\u303F]/g;
    const matches = text.match(japaneseRegex) || [];
    return matches.length / text.length;
}

/**
 * Extract comments from source code using Tree-sitter AST analysis
 */
export async function extractCommentsWithTreeSitter(
    text: string,
    languageId: string,
    minJapaneseRatio = 0.1
): Promise<CommentRange[]> {
    if (!parserInstance) {
        throw new Error('Tree-sitter not initialized. Call initializeTreeSitter() first.');
    }

    const language = await loadLanguage(languageId);
    if (!language) {
        return []; // Language not supported
    }

    parserInstance.setLanguage(language);
    const tree = parserInstance.parse(text);
    const comments: CommentRange[] = [];

    // Traverse the tree using a stack (depth-first)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stack: any[] = [tree.rootNode];

    while (stack.length > 0) {
        const node = stack.pop()!;

        // Check if this node is a comment
        const isComment = isCommentNode(node.type, languageId);
        const isDocstring = languageId === 'python' && isPythonDocstring(node);

        if (isComment || isDocstring) {
            const original = node.text;
            const sanitized = sanitizeComment(original, languageId);

            // Only include if it contains sufficient Japanese characters
            if (calculateJapaneseRatio(sanitized) >= minJapaneseRatio) {
                comments.push({
                    start: node.startIndex,
                    end: node.endIndex,
                    text: sanitized,
                    original,
                });
            }
        }

        // Add children to stack (in reverse order to maintain order)
        for (let i = node.childCount - 1; i >= 0; i--) {
            const child = node.child(i);
            if (child) {
                stack.push(child);
            }
        }
    }

    return comments;
}

/**
 * Extract text content from HTML using Tree-sitter
 */
export async function extractHtmlContentWithTreeSitter(
    text: string,
    minJapaneseRatio = 0.1
): Promise<CommentRange[]> {
    if (!parserInstance) {
        throw new Error('Tree-sitter not initialized. Call initializeTreeSitter() first.');
    }

    const language = await loadLanguage('html');
    if (!language) {
        return [];
    }

    parserInstance.setLanguage(language);
    const tree = parserInstance.parse(text);
    const contents: CommentRange[] = [];

    // Find text nodes (raw_text, text)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stack: any[] = [tree.rootNode];
    const textNodeTypes = ['text', 'raw_text'];

    // Elements to skip (script, style)
    const skipElements = ['script', 'style'];

    while (stack.length > 0) {
        const node = stack.pop()!;

        // Skip script and style elements
        if (node.type === 'element') {
            const tagNode = node.childForFieldName?.('tag_name') || node.child(0);
            if (tagNode && skipElements.includes(tagNode.text.toLowerCase())) {
                continue;
            }
        }

        // Extract text content
        if (textNodeTypes.includes(node.type)) {
            const content = node.text.trim();
            if (content && calculateJapaneseRatio(content) >= minJapaneseRatio) {
                contents.push({
                    start: node.startIndex,
                    end: node.endIndex,
                    text: content,
                    original: node.text,
                });
            }
        }

        // Add children to stack
        for (let i = node.childCount - 1; i >= 0; i--) {
            const child = node.child(i);
            if (child) {
                stack.push(child);
            }
        }
    }

    return contents;
}

/**
 * Check if Tree-sitter is initialized and ready
 */
export function isTreeSitterReady(): boolean {
    return parserInstance !== null;
}

/**
 * Check if a language is supported by Tree-sitter
 */
export function isLanguageSupported(languageId: string): boolean {
    return languageId in languageGrammarMap;
}

/**
 * Get list of supported languages
 */
export function getSupportedLanguages(): string[] {
    return Object.keys(languageGrammarMap);
}

