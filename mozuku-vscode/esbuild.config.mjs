/**
 * esbuild configuration for MoZuku VSCode Extension
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

async function build() {
  try {
    // Ensure dist directories exist
    fs.mkdirSync('dist/client', { recursive: true });
    fs.mkdirSync('dist/server', { recursive: true });

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
