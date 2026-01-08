# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Wakame is a VSCode extension that provides Japanese text linting and proofreading via the Language Server Protocol (LSP). It uses MeCab (via mecab-wasm) for high-accuracy morphological analysis and Tree-sitter for AST-based comment extraction from source code files.

## Commands

```bash
npm run build        # Build client and server with esbuild
npm run watch        # Watch mode for development
npm run typecheck    # Run TypeScript type checking
npm run lint         # Run oxlint (quiet mode)
npm run lint:strict  # Run oxlint with warnings as errors
npm run lint:fix     # Auto-fix linting issues
npm run test         # Run tests with vitest
npm run check        # Run typecheck and lint:strict
npm run package      # Package as .vsix for distribution
```

## Architecture

### LSP Client-Server Model

The extension follows the standard VSCode LSP architecture:

- **Client** (`src/client/extension.ts`): VSCode extension entry, initializes LanguageClient, communicates with server via IPC
- **Server** (`src/server/server.ts`): Handles document analysis, diagnostics, hover, and semantic tokens

### Core Analysis Pipeline

1. **Text Extraction** (`analyzer.ts`, `treeSitterExtractor.ts`): For code files, extracts Japanese text from comments using Tree-sitter AST parsing (with regex fallback). For plaintext/markdown, analyzes entire document.

2. **Tokenization** (`analyzer.ts`, `mecabAnalyzer.ts`): Uses MeCab WASM for high-accuracy morphological analysis with IPADIC dictionary.

3. **Grammar Checking** (`grammar.ts`): Runs rule-based checks on tokenized sentences. Rules are inspired by [MoZuku](https://github.com/t3tra-dev/MoZuku).

4. **Results Delivery**: Diagnostics sent to client; semantic tokens provide POS-based syntax highlighting.

### Grammar Rules (in `grammar.ts`)

- `comma-limit`: Limits commas (読点「、」) per sentence
- `adversative-ga`: Warns on multiple adversative が in one sentence
- `duplicate-particle`: Detects consecutive identical particles
- `adjacent-particles`: Detects adjacent particles of same type
- `conjunction-repeat`: Warns on repeated conjunctions
- `ra-dropping`: Detects ら抜き言葉 (ra-dropping in potential form)

### Shared Types

All shared interfaces are in `src/shared/types.ts`. Key types:
- `Token`: Morphological analysis result with POS, readings, conjugation info
- `Sentence`: Sentence boundary with contained tokens
- `WakameConfig`: Extension configuration schema
- `DiagnosticInfo`: Linting diagnostic format

### MeCab WASM

The extension uses mecab-wasm with bundled IPADIC dictionary for morphological analysis. WASM files are copied to `dist/wasm/` during build.
