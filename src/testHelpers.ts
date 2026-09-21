// Shared helpers for the test suites. Excluded from the build in tsconfig.json.

/** Waits for timers and promise callbacks scheduled within the next `ms` milliseconds */
export const flush = (ms = 20): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Silences console.error for each test in the enclosing describe block.
 * @returns A holder whose `spy` is the current test's console.error spy
 */
export const silenceConsoleError = (): { spy: jest.SpyInstance } => {
  const holder = {} as { spy: jest.SpyInstance }
  beforeEach(() => { holder.spy = jest.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { holder.spy.mockRestore() })
  return holder
}

/** A worker run whose outcome the test controls */
export type ControlledRun = { id: string; resolve: () => void; reject: (err: Error) => void }

/**
 * A worker that never settles on its own
 * @returns The worker, and the runs it has started so the test can settle them
 */
export const controlledWorker = <T extends { id: string }>() => {
  const runs: ControlledRun[] = []
  const worker = (item: T) => new Promise<void>((resolve, reject) => {
    runs.push({ id: item.id, resolve, reject })
  })
  return { runs, worker }
}
