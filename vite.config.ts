import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import pkg from './package.json' with { type: 'json' }

const require = createRequire(import.meta.url)

const OUT_DIR = 'dist'

// The bundle paths come from package.json, which consumers resolve them through.
const BUNDLES: Record<string, string> = {
  es: pkg.module,
  cjs: pkg.common,
  umd: pkg.browser,
}

// The type declarations use `export default`, so TypeScript CommonJS consumers read require(...).default.
// Make that the constructor too, alongside module.exports itself. `module` is absent in a browser.
// The footer is added before minification, so the minifier folds it into the bundle.
const commonJsDefault = 'if (typeof module === "object" && module.exports) module.exports.default = module.exports;'

/**
 * The tsc script that builds the declarations; src/typescript.test.ts checks its version.
 * TypeScript 7 is installed as @typescript/native, because `typescript` is the TypeScript 6 API
 * that typescript-eslint imports. Its "exports" map hides bin/tsc, so it is found through package.json's "bin".
 */
export function tscPath(): string {
  const manifest = require.resolve('@typescript/native/package.json')
  return path.join(path.dirname(manifest), require(manifest).bin.tsc)
}

// Writes the per-module .d.ts files with tsc, which also type-checks the source: Vite has no
// declaration output and does not type-check. It hooks the ES output's writeBundle, which runs
// once per build and per rebuild under --watch, after Vite has emptied dist/, and not at all
// when bundling fails. A type error fails `vite build`; under --watch it is reported and watching goes on.
function declarations(): Plugin {
  return {
    name: 'declarations',
    apply: 'build',
    writeBundle(options) {
      if (options.format !== 'es') return
      execFileSync(process.execPath, [tscPath(), '-p', 'tsconfig.build.json', '--emitDeclarationOnly'], { stdio: 'inherit' })
    },
  }
}

export default defineConfig({
  publicDir: false,
  plugins: [declarations()],
  build: {
    outDir: OUT_DIR,
    // Clears stale output; the declarations plugin writes the .d.ts files after each build
    emptyOutDir: true,
    target: 'es2022',
    // Vite's built-in minifier. In library mode it leaves the ES bundle's whitespace, so the
    // consumer's bundler keeps its annotations for tree-shaking; the others are fully minified.
    minify: 'oxc',
    lib: {
      entry: 'src/processQueue.ts',
      name: 'ProcessQueue',
      fileName: format => path.posix.relative(OUT_DIR, BUNDLES[format]),
    },
    rolldownOptions: {
      // One entry per bundle, because only the CommonJS-capable ones get the footer.
      // Library mode ignores build.lib.formats when this is an array.
      output: [
        // strict: true would put "use strict" at the top of the file, making every script concatenated
        // after it strict too. The intro puts it inside the UMD factory instead, as Rollup did.
        { format: 'umd', name: 'ProcessQueue', exports: 'default', strict: false, intro: '"use strict";', footer: commonJsDefault },
        { format: 'cjs', exports: 'default', strict: true, footer: commonJsDefault },
        { format: 'es' },
      ],
    },
  },
  test: {
    environment: 'node',
    globals: true,
    // Only the TypeScript suites: smoke/ holds node:test files run by `npm run test:smoke`
    include: ['src/**/*.test.ts'],
  },
})
