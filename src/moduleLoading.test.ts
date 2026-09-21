import { createRequire } from 'module'
import { resolve } from 'path'
import { readdirSync, readFileSync } from 'fs'

const req = createRequire(__filename)
const distDir = resolve(__dirname, '..', 'dist')

describe('Module Loading', () => {
  describe('type declarations', () => {
    test('do not expose @internal members', () => {
      const declarations = readFileSync(resolve(distDir, 'processQueue.d.ts'), 'utf-8')
      expect(declarations).toContain('declare class ProcessQueue')
      expect(declarations).not.toContain('_bookkeepingSizes')
    })

    // No bundle has a named ProcessQueue export, so no declaration may claim one
    test('declare only the default export at runtime', () => {
      const declarationFiles = (readdirSync(distDir, { recursive: true }) as string[])
        .filter(file => file.endsWith('.d.ts'))
      const claimsNamedExport = declarationFiles.filter(file =>
        /default as ProcessQueue/.test(readFileSync(resolve(distDir, file), 'utf-8')))
      expect(claimsNamedExport).toEqual([])
    })

    // The package is "type": "module", so under node16/nodenext resolution TypeScript reads
    // the declarations as ESM, where relative imports need a file extension
    test('use file extensions on every relative import', () => {
      const declarationFiles = (readdirSync(distDir, { recursive: true }) as string[])
        .filter(file => file.endsWith('.d.ts'))
      expect(declarationFiles.length).toBeGreaterThan(1)
      const extensionless = declarationFiles.flatMap(file => {
        const source = readFileSync(resolve(distDir, file), 'utf-8')
        return [...source.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)]
          .map(match => match[1])
          .filter(path => !/\.(js|cjs|mjs)$/.test(path))
          .map(path => `${file}: ${path}`)
      })
      expect(extensionless).toEqual([])
    })
  })

  // The types declare `export default`, so TypeScript CommonJS consumers compile to require(...).default;
  // plain JavaScript uses require(...) itself. Both must be the constructor.
  test.each(['processQueue.cjs', 'processQueue.umd.js'])('%s exports the constructor as module.exports and .default', file => {
    const exported = req(resolve(distDir, file))
    expect(typeof exported).toBe('function')
    expect(exported.default).toBe(exported)
  })

  describe('CJS (require)', () => {
    let ProcessQueue: any

    beforeAll(() => {
      ProcessQueue = req(resolve(distDir, 'processQueue.cjs'))
    })

    test('exports a default constructor', () => {
      const PQ = ProcessQueue.default || ProcessQueue
      expect(typeof PQ).toBe('function')
    })

    test('can instantiate and use the queue', () => {
      const PQ = ProcessQueue.default || ProcessQueue
      const queue = new PQ()
      expect(queue.queueItem({ id: '1', value: 'cjs' })).toBe(true)
      expect(queue.length()).toBe(1)
      const item = queue.getNextItem()
      expect(item.id).toBe('1')
    })
  })

  describe('UMD (require)', () => {
    let ProcessQueue: any

    beforeAll(() => {
      ProcessQueue = req(resolve(distDir, 'processQueue.umd.js'))
    })

    test('exports a default constructor', () => {
      const PQ = ProcessQueue.default || ProcessQueue
      expect(typeof PQ).toBe('function')
    })

    test('can instantiate and use the queue', () => {
      const PQ = ProcessQueue.default || ProcessQueue
      const queue = new PQ()
      expect(queue.queueItem({ id: '2', value: 'umd' })).toBe(true)
      expect(queue.length()).toBe(1)
      const item = queue.getNextItem()
      expect(item.id).toBe('2')
    })
  })

  describe('ESM (dist/processQueue.mjs)', () => {
    let content: string

    beforeAll(() => {
      content = readFileSync(resolve(distDir, 'processQueue.mjs'), 'utf-8')
    })

    test('file exists and has export default', () => {
      expect(content).toBeDefined()
      expect(content.length).toBeGreaterThan(0)
      expect(content).toContain('export')
    })

    test('does not use require() or module.exports', () => {
      expect(content).not.toContain('module.exports')
      expect(content).not.toContain('require(')
    })

    test('ESM source import works (via ts-jest transform)', async () => {
      // This test file itself uses ESM import of the source, proving ESM works
      const { default: ProcessQueue } = await import('./processQueue')
      const queue = new ProcessQueue()
      expect(queue.queueItem({ id: '3', value: 'esm' })).toBe(true)
      expect(queue.length()).toBe(1)
    })
  })
})
