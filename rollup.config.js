import typescript from "@rollup/plugin-typescript"
import terser from '@rollup/plugin-terser';

export default [
  {
    input: "src/processQueue.ts",
    output: [
      { file: "dist/processQueue.umd.js", format: "umd", name: "ProcessQueue", exports: "default" },
      { file: "dist/processQueue.cjs", format: "cjs", name: "ProcessQueue", exports: "default" },
      { file: "dist/processQueue.mjs", format: "es", name: "ProcessQueue" }
    ],
    plugins: [
      typescript(),
      terser()
    ]
  }
]