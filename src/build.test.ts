// Checks the build configuration itself, as Vite resolves it from vite.config.ts.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('build', () => {
  test("minifies with Vite's built-in Oxc minifier, so terser is not a dependency", async () => {
    const config = await resolveConfig({ root, configFile: resolve(root, 'vite.config.ts') }, 'build')
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'))

    expect(config.build.minify).toBe('oxc')
    expect(pkg.devDependencies).not.toHaveProperty('terser')
  }, 30000)

  // Reads the built dist/, so run `npm run build` first
  test('emits no declarations for the test-only modules', () => {
    const declarations = readdirSync(resolve(root, 'dist'), { recursive: true, encoding: 'utf-8' })
      .map(file => file.replaceAll('\\', '/'))
      .filter(file => file.endsWith('.d.ts'))

    expect(declarations).toContain('internal/orderedQueue.d.ts')
    expect(declarations.filter(file => /\.test\.d\.ts$|\.reference\.d\.ts$|testHelpers\.d\.ts$/.test(file))).toEqual([])
  })
})
