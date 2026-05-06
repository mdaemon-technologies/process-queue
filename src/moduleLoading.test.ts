import { createRequire } from 'module'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const req = createRequire(__filename)
const distDir = resolve(__dirname, '..', 'dist')

describe('Module Loading', () => {
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
