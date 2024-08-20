import typescript from "@rollup/plugin-typescript"

export default [
  {
    input: "src/processQueue.ts",
    output: [
      { file: "dist/processQueue.umd.js", format: "umd", name: "ProcessQueue", exports: "default" },
      { file: "dist/processQueue.cjs", format: "cjs", exports: "default" },
      { file: "dist/processQueue.mjs", format: "es" }
    ],
    plugins: [
      typescript()
    ]
  }
]