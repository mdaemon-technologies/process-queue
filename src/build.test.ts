// Checks the build configuration itself, as Vite resolves it from vite.config.ts.
import { readFileSync } from 'node:fs'
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
})
