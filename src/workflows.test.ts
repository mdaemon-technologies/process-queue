// Checks the GitHub Actions workflows in .github/workflows.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('workflows', () => {
  // package-lock.json is written by npm 11, which leaves typescript-eslint's unmet optional peer
  // `@typescript/native` (it wants a 7.1 nightly) alone. npm 10, which ships with Node 22, tries
  // to nest the newest nightly instead, so its `npm ci` rejects the lockfile as out of sync.
  test.each(['node.js.yml', 'publish.yml'])('install with npm 11 in the %s workflow', file => {
    const workflow = readFileSync(resolve(root, '.github/workflows', file), 'utf8')
    const installs = workflow.match(/- run: npm ci\r?\n/g) ?? []
    const upgraded = workflow.match(/- run: npm install -g npm@11[^\S\r\n]*(#[^\r\n]*)?\r?\n(\s*#[^\r\n]*\r?\n)*\s*- run: npm ci\r?\n/g) ?? []

    expect(installs.length).toBeGreaterThan(0)
    expect(upgraded.length).toBe(installs.length)
  })
})
