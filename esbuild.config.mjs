/**
 * esbuild configuration for Wakame VSCode Extension
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const isWatch = process.argv.includes('--watch');
const isProduction = process.argv.includes('--production');

// Common build options
const commonOptions = {
  bundle: true,
  minify: isProduction,
  sourcemap: !isProduction,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  logLevel: 'info',
};

// Build client (extension)
const clientOptions = {
  ...commonOptions,
  entryPoints: ['src/client/extension.ts'],
  outfile: 'dist/client/extension.js',
  external: ['vscode'],
};

// Build server
const serverOptions = {
  ...commonOptions,
  entryPoints: ['src/server/server.ts'],
  outfile: 'dist/server/server.js',
  external: ['vscode'],
};

/**
 * Copy Tree-sitter WASM files to dist/wasm
 */
function copyWasmFiles() {
  const wasmDir = 'dist/wasm';
  fs.mkdirSync(wasmDir, { recursive: true });

  // WASM files to copy
  const wasmFiles = [
    // Tree-sitter runtime
    { src: 'node_modules/web-tree-sitter/web-tree-sitter.wasm', dest: 'web-tree-sitter.wasm' },
    // Language grammars
    { src: 'node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm', dest: 'tree-sitter-javascript.wasm' },
    { src: 'node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm', dest: 'tree-sitter-typescript.wasm' },
    { src: 'node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm', dest: 'tree-sitter-tsx.wasm' },
    { src: 'node_modules/tree-sitter-python/tree-sitter-python.wasm', dest: 'tree-sitter-python.wasm' },
    { src: 'node_modules/tree-sitter-c/tree-sitter-c.wasm', dest: 'tree-sitter-c.wasm' },
    { src: 'node_modules/tree-sitter-html/tree-sitter-html.wasm', dest: 'tree-sitter-html.wasm' },
  ];

  let copiedCount = 0;
  for (const { src, dest } of wasmFiles) {
    try {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(wasmDir, dest));
        copiedCount++;
      } else {
        console.warn(`WASM file not found: ${src}`);
      }
    } catch (error) {
      console.warn(`Failed to copy ${src}: ${error.message}`);
    }
  }
  console.log(`Copied ${copiedCount}/${wasmFiles.length} Tree-sitter WASM files`);
}

async function build() {
  try {
    // Ensure dist directories exist
    fs.mkdirSync('dist/client', { recursive: true });
    fs.mkdirSync('dist/server', { recursive: true });

    // Copy Tree-sitter WASM files
    copyWasmFiles();

    if (isWatch) {
      // Watch mode
      const clientContext = await esbuild.context(clientOptions);
      const serverContext = await esbuild.context(serverOptions);

      await Promise.all([clientContext.watch(), serverContext.watch()]);
      console.log('Watching for changes...');
    } else {
      // Single build
      await Promise.all([
        esbuild.build(clientOptions),
        esbuild.build(serverOptions),
      ]);
      console.log('Build completed successfully');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();

