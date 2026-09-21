import typescript from "@rollup/plugin-typescript"
import terser from '@rollup/plugin-terser';

// The type declarations use `export default`, so TypeScript CommonJS consumers read require(...).default.
// Make that the constructor too, alongside module.exports itself. `module` is absent in a browser.
const commonJsDefault = 'if (typeof module === "object" && module.exports) module.exports.default = module.exports;';

export default [
  {
    input: "src/processQueue.ts",
    output: [
      { file: "dist/processQueue.umd.js", format: "umd", name: "ProcessQueue", exports: "default", footer: commonJsDefault },
      { file: "dist/processQueue.cjs", format: "cjs", name: "ProcessQueue", exports: "default", footer: commonJsDefault },
      { file: "dist/processQueue.mjs", format: "es", name: "ProcessQueue" }
    ],
    plugins: [
      typescript(),
      terser()
    ]
  }
]
