// Checks the TypeScript toolchain: that the build and `npm run typecheck` use TypeScript 7, and
// that the published declarations work the way consumers use them, by type-checking the fixtures
// in test-types/ with the tsc that builds the declarations. Reads dist/, so run `npm run build` first.
import { execSync, spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tscPath } from '../vite.config'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// A spawn timeout, because Vitest's own cannot interrupt a synchronous spawn
const tsc = (...args: string[]) =>
  spawnSync(process.execPath, [tscPath(), ...args], { cwd: root, encoding: 'utf8', timeout: 50000 })

// A package with a `tsc` bin of its own, such as @typescript/typescript6, can win
// node_modules/.bin/tsc and quietly downgrade `npm run typecheck`.
describe('TypeScript 7', () => {
  test('builds the declarations', () => {
    expect(tsc('--version').stdout).toMatch(/^Version 7\./)
  }, 60000)

  test('type-checks for npm run typecheck', () => {
    const output = execSync('npm run --silent typecheck -- --version', { cwd: root, encoding: 'utf8', timeout: 50000 })
    expect(output.trim()).toMatch(/^Version 7\./)
  }, 60000)
})

describe('consumer type fixtures', () => {
  test.each(['nodenext', 'bundler'])('type-check under %s resolution', resolution => {
    const result = tsc('-p', `test-types/tsconfig.${resolution}.json`)
    expect(result.stdout + result.stderr).toBe('')
    expect(result.status).toBe(0)
  }, 60000)
})
