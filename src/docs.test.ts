// Checks the repository's Markdown documentation.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('docs', () => {
  test('README links to recipes.md, which exists', () => {
    const readme = readFileSync(resolve(root, 'README.md'), 'utf-8')

    expect(readme).toContain('](recipes.md)')
    // Exact name: GitHub links are case-sensitive even where the file system is not
    expect(readdirSync(root)).toContain('recipes.md')
  })
})
