import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { harness } from './harness.ts'

const NOW = '2026-09-16T00:00:00.000Z'
const DAY_MS = 24 * 60 * 60 * 1000
const RETENTION_MS = 30 * DAY_MS

type PurgeResult = { purgedCount: number; purgedSessionIds: readonly string[] }

const tests: Awaited<ReturnType<typeof harness>>[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
})

afterEach(async () => {
  for (const test of tests.splice(0)) await test.ctx.fiber.dispose()
  vi.useRealTimers()
})

async function setup(options?: Parameters<typeof harness>[0]) {
  const test = await harness(options ?? {})
  tests.push(test)
  return test
}

/** Next local 03:00 fire time, computed with the same arithmetic as the service. */
function nextPurgeAt(from: Date): Date {
  const nextRun = new Date(from)
  nextRun.setHours(3, 0, 0, 0)
  if (nextRun <= from) nextRun.setDate(nextRun.getDate() + 1)
  return nextRun
}

function purgeCallback(result: PurgeResult = { purgedCount: 0, purgedSessionIds: [] }) {
  return vi.fn(async (_cutoffDate: Date): Promise<PurgeResult> => result)
}

async function advanceTo(date: Date): Promise<void> {
  await vi.advanceTimersByTimeAsync(date.getTime() - Date.now() + 1)
}

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

describe('trash auto-purge timer', () => {
  it('fires at the next local 03:00 with the retention cutoff and re-arms daily', async () => {
    const test = await setup()
    const callback = purgeCallback()
    test.service.registerTrashPurgeCallback(callback)

    const fireAt = nextPurgeAt(new Date(NOW))
    await advanceTo(fireAt)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenNthCalledWith(1, new Date(fireAt.getTime() - RETENTION_MS))

    await advanceTo(new Date(fireAt.getTime() + DAY_MS))
    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback).toHaveBeenNthCalledWith(2, new Date(fireAt.getTime() + DAY_MS - RETENTION_MS))
  })

  it('keeps a pending timer when a second callback registers and fires the latest one', async () => {
    const test = await setup()
    const first = purgeCallback()
    const replacement = purgeCallback()
    test.service.registerTrashPurgeCallback(first)
    test.service.registerTrashPurgeCallback(replacement)

    const fireAt = nextPurgeAt(new Date(NOW))
    await advanceTo(fireAt)
    expect(first).not.toHaveBeenCalled()
    expect(replacement).toHaveBeenCalledTimes(1)
    expect(replacement).toHaveBeenNthCalledWith(1, new Date(fireAt.getTime() - RETENTION_MS))
  })

  it('never arms when trashRetentionDays is 0', async () => {
    const test = await setup({ config: { trashRetentionDays: 0 } })
    const callback = purgeCallback()
    test.service.registerTrashPurgeCallback(callback)
    await vi.advanceTimersByTimeAsync(3 * DAY_MS)
    expect(callback).not.toHaveBeenCalled()
  })

  it('stops re-arming once the disposer runs, even after a fire', async () => {
    const test = await setup()
    const callback = purgeCallback()
    const dispose = test.service.registerTrashPurgeCallback(callback)
    await advanceTo(nextPurgeAt(new Date(NOW)))
    expect(callback).toHaveBeenCalledTimes(1)
    dispose()
    await vi.advanceTimersByTimeAsync(3 * DAY_MS)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending timer on shutdown', async () => {
    const test = await harness({}) // disposed inline, not tracked in `tests`
    const callback = purgeCallback()
    test.service.registerTrashPurgeCallback(callback)
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000) // still before the next local 03:00
    await test.ctx.fiber.dispose()
    await vi.advanceTimersByTimeAsync(3 * DAY_MS)
    expect(callback).not.toHaveBeenCalled()
  })

  it('never arms a timer after shutdown', async () => {
    const test = await harness({}) // disposed inline, not tracked in `tests`
    await test.ctx.fiber.dispose()
    const callback = purgeCallback()
    test.service.registerTrashPurgeCallback(callback)
    await vi.advanceTimersByTimeAsync(3 * DAY_MS)
    expect(callback).not.toHaveBeenCalled()
  })

  it('logs a failed purge and still re-arms', async () => {
    const test = await setup()
    const error = vi.spyOn(test.ctx.logger, 'error')
    const callback = vi.fn(async (_cutoffDate: Date): Promise<PurgeResult> => {
      throw new Error('purge boom')
    })
    test.service.registerTrashPurgeCallback(callback)
    const fireAt = nextPurgeAt(new Date(NOW))
    await advanceTo(fireAt)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('auto-purge failed'))
    await advanceTo(new Date(fireAt.getTime() + DAY_MS))
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('logs how many trashed sessions the purge deleted', async () => {
    const test = await setup()
    const info = vi.spyOn(test.ctx.logger, 'info')
    const callback = purgeCallback({ purgedCount: 2, purgedSessionIds: ['a', 'b'] })
    test.service.registerTrashPurgeCallback(callback)
    await advanceTo(nextPurgeAt(new Date(NOW)))
    expect(info).toHaveBeenCalledWith(expect.stringContaining('auto-purge deleted 2'))
  })

  it('does not re-arm when the service shuts down while a purge is in flight', async () => {
    const test = await harness({}) // disposed inline, not tracked in `tests`
    const gate = deferred<PurgeResult>()
    const callback = vi.fn((_cutoffDate: Date): Promise<PurgeResult> => gate.promise)
    test.service.registerTrashPurgeCallback(callback)
    const fireAt = nextPurgeAt(new Date(NOW))
    vi.advanceTimersByTime(fireAt.getTime() - Date.now() + 1) // sync: the fire stays in flight
    expect(callback).toHaveBeenCalledTimes(1)
    await test.ctx.fiber.dispose()
    gate.resolve({ purgedCount: 0, purgedSessionIds: [] })
    await vi.advanceTimersByTimeAsync(3 * DAY_MS)
    expect(callback).toHaveBeenCalledTimes(1)
  })
})
