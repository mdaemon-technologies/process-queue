// Checks the ESLint setup in eslint.config.js: which files it lints, with which rules, and that
// the repository passes `npm run lint`.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const eslint = new ESLint({ cwd: root })

// The rule IDs ESLint reports for some code, as if it were the file at path (which need not exist)
async function ruleIds(path: string, code: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(root, path) })
  return result.messages.map(message => message.ruleId)
}

describe('eslint.config.js', () => {
  // typescript-eslint's rules show that TypeScript is parsed and its recommended rules apply
  test.each([
    'src/example.ts',
    'src/internal/example.test.ts',
    'vite.config.ts',
    'test-types/example.mts',
    'test-types/example.cts',
    'test-types/example.bundler.ts',
  ])('lints %s with the TypeScript rules', async path => {
    expect(await ruleIds(path, "const value: string = ''\n")).toEqual(['@typescript-eslint/no-unused-vars'])
  }, 30000)

  // Tests pass values the types forbid, to check the runtime validation
  test.each([
    ['src/example.ts', ['@typescript-eslint/no-explicit-any']],
    ['test-types/example.mts', ['@typescript-eslint/no-explicit-any']],
    ['src/example.test.ts', []],
    ['src/internal/example.test.ts', []],
  ])('in %s, any is reported: %j', async (path, expected) => {
    expect(await ruleIds(path, 'export const value: any = 1\n')).toEqual(expected)
  }, 30000)

  // So a stale disable comment fails CI rather than warning
  test('reports an unused eslint-disable comment as an error', async () => {
    const [result] = await eslint.lintText('// eslint-disable-next-line no-undef\nexport const value = 1\n', { filePath: resolve(root, 'src/example.ts') })
    expect(result.messages.map(({ ruleId, severity }) => ({ ruleId, severity }))).toEqual([{ ruleId: null, severity: 2 }])
  }, 30000)

  test('lints the CommonJS smoke tests as Node scripts', async () => {
    const code = "'use strict'\nconst fs = require('node:fs')\nprocess.exitCode = 0\nmodule.exports = fs\nmissing()\n"
    expect(await ruleIds('smoke/example.cjs', code)).toEqual(['no-undef'])
  }, 30000)

  test('lints the ES module smoke tests as Node modules', async () => {
    const code = "import fs from 'node:fs'\nprocess.exitCode = 0\nexport default fs\nmissing()\n"
    expect(await ruleIds('smoke/example.mjs', code)).toEqual(['no-undef'])
  }, 30000)

  test.each(['eslint.config.js', 'src/processQueue.ts', 'smoke/exercise.cjs'])('lints %s', async path => {
    expect(await eslint.isPathIgnored(resolve(root, path))).toBe(false)
  })

  test.each(['dist/processQueue.mjs', 'dist/processQueue.cjs', 'dist/processQueue.d.ts'])('ignores the built %s', async path => {
    expect(await eslint.isPathIgnored(resolve(root, path))).toBe(true)
  })
})

describe('npm run lint', () => {
  // ESLint prints nothing when the code is clean, so a failure shows its report. A spawn timeout,
  // because Vitest's own cannot interrupt a synchronous spawn.
  test('passes', () => {
    const result = spawnSync('npm run --silent lint', { cwd: root, encoding: 'utf8', shell: true, timeout: 50000 })
    expect(result.stdout + result.stderr).toBe('')
    expect(result.status).toBe(0)
  }, 60000)

  // Right after `npm ci`, in every job that installs the toolchain, so a lint error fails before the build
  test.each(['node.js.yml', 'publish.yml'])('runs in the %s workflow', file => {
    const workflow = readFileSync(resolve(root, '.github/workflows', file), 'utf8')
    const installs = workflow.match(/- run: npm ci\r?\n/g) ?? []
    const lints = workflow.match(/- run: npm ci\r?\n\s*- run: npm run lint\r?\n/g) ?? []

    expect(installs.length).toBeGreaterThan(0)
    expect(lints.length).toBe(installs.length)
  })

  test('runs before npm run pub publishes', () => {
    const { scripts } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    const steps: string[] = scripts.pub.split(' && ')

    expect(steps).toContain('npm run lint')
    expect(steps.indexOf('npm run lint')).toBeLessThan(steps.indexOf('npm publish'))
  })
})
