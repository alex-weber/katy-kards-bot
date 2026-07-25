// Unit tests for the DB sync runner. child_process.spawn is mocked, so no card
// sync is ever started and no network/DB access is required.

const EventEmitter = require('events')

jest.mock('child_process', () => ({ spawn: jest.fn() }))
jest.mock('../src/controller/redis', () => ({
    redis: {
        json: {
            get: jest.fn(async () => null),
            set: jest.fn(async () => 'OK'),
        },
    },
    cachePrefix: 'web:test:',
}))

const { spawn } = require('child_process')
const { redis } = require('../src/controller/redis')

// A stand-in for the spawned sync process: tests drive it by emitting the same
// 'message'/'close'/'error' events the real child emits.
function makeChild() {
    return new EventEmitter()
}

// Module-level state (the running flag) has to be fresh for every test.
function loadRunner() {
    let runner
    jest.isolateModules(() => { runner = require('../src/tools/syncRunner') })
    return runner
}

beforeEach(() => {
    jest.clearAllMocks()
    redis.json.get.mockResolvedValue(null)
})

describe('startSync', () => {
    test('spawns the sync script and reports it started', () => {
        const child = makeChild()
        spawn.mockReturnValueOnce(child)
        const runner = loadRunner()

        expect(runner.startSync()).toEqual({ started: true })
        expect(spawn).toHaveBeenCalledTimes(1)
        expect(spawn.mock.calls[0][1][0]).toMatch(/sync\.js$/)
        expect(runner.isSyncRunning()).toBe(true)
    })

    test('refuses to start a second sync while one is running', () => {
        spawn.mockReturnValueOnce(makeChild())
        const runner = loadRunner()

        runner.startSync()
        const second = runner.startSync()

        expect(second.started).toBe(false)
        expect(second.reason).toMatch(/already running/i)
        expect(spawn).toHaveBeenCalledTimes(1)
    })

    test('allows a new sync once the previous one closed', async () => {
        const child = makeChild()
        spawn.mockReturnValueOnce(child).mockReturnValueOnce(makeChild())
        const runner = loadRunner()

        runner.startSync()
        child.emit('close', 0)
        await Promise.resolve()

        expect(runner.isSyncRunning()).toBe(false)
        expect(runner.startSync().started).toBe(true)
    })

    test('reports a failure to spawn instead of throwing', () => {
        spawn.mockImplementationOnce(() => { throw new Error('ENOENT') })
        const runner = loadRunner()

        const result = runner.startSync()

        expect(result.started).toBe(false)
        expect(runner.isSyncRunning()).toBe(false)
    })

})

describe('the stored result', () => {
    async function runSync(messages, code = 0, options = {}) {
        const child = makeChild()
        spawn.mockReturnValueOnce(child)
        const runner = loadRunner()

        runner.startSync(options)
        messages.forEach(message => child.emit('message', message))
        child.emit('close', code)
        // let the async close handler write to redis
        await new Promise(resolve => setImmediate(resolve))

        return redis.json.set.mock.calls[0][2]
    }

    test('keeps the counts the child reported', async () => {
        const stored = await runSync([
            { type: 'result', created: 4, updated: 11, totalCards: 900, seconds: 12.5 },
        ])

        expect(stored).toMatchObject({ ok: true, created: 4, updated: 11, totalCards: 900, error: null })
        expect(stored.finishedAt).toEqual(expect.any(String))
    })

    test('records who triggered it', async () => {
        const stored = await runSync(
            [{ type: 'result', created: 0, updated: 0, totalCards: 900, seconds: 1 }],
            0,
            { triggeredBy: 'Katy' })

        expect(stored.triggeredBy).toBe('Katy')
    })

    test('is a failure when the child exits non-zero', async () => {
        const stored = await runSync([], 1)

        expect(stored.ok).toBe(false)
        expect(stored.created).toBe(0)
        expect(stored.error).toMatch(/code 1/)
    })

    // sync.js exits 0 even when it bails out early (syncDB just returns false),
    // so a missing result message is the only signal that nothing was written.
    test('is a failure when the child exits 0 without a result', async () => {
        const stored = await runSync([{ type: 'error', text: 'kards.com returned no cards' }])

        expect(stored.ok).toBe(false)
        expect(stored.error).toBe('kards.com returned no cards')
    })
})

// The child has to exit for 'close' to fire, and sync.js pulls in modules that
// open a Redis connection at import time — so a missing exit leaves the flag,
// and the page's button, stuck. The watchdog is the backstop for that.
describe('the watchdog', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    test('kills a child that never closes and releases the lock', async () => {
        const child = makeChild()
        child.kill = jest.fn(() => child.emit('close', null))
        spawn.mockReturnValueOnce(child)
        const runner = loadRunner()

        runner.startSync()
        expect(runner.isSyncRunning()).toBe(true)

        jest.advanceTimersByTime(15 * 60 * 1000)
        await Promise.resolve()

        expect(child.kill).toHaveBeenCalledWith('SIGKILL')
        expect(runner.isSyncRunning()).toBe(false)
    })

    test('records the timeout as the stored failure', async () => {
        const child = makeChild()
        child.kill = jest.fn(() => child.emit('close', null))
        spawn.mockReturnValueOnce(child)
        const runner = loadRunner()

        runner.startSync()
        jest.advanceTimersByTime(15 * 60 * 1000)
        // setImmediate is faked too, so let the async close handler run for real.
        jest.useRealTimers()
        await new Promise(resolve => setImmediate(resolve))

        const stored = redis.json.set.mock.calls[0][2]
        expect(stored.ok).toBe(false)
        expect(stored.error).toMatch(/timed out/i)
    })

    test('does not fire for a sync that finished normally', async () => {
        const child = makeChild()
        child.kill = jest.fn()
        spawn.mockReturnValueOnce(child)
        const runner = loadRunner()

        runner.startSync()
        child.emit('message', { type: 'result', created: 1, updated: 0, totalCards: 900, seconds: 1 })
        child.emit('close', 0)
        jest.advanceTimersByTime(60 * 60 * 1000)
        jest.useRealTimers()
        await new Promise(resolve => setImmediate(resolve))

        expect(child.kill).not.toHaveBeenCalled()
        expect(redis.json.set.mock.calls[0][2].ok).toBe(true)
    })
})

describe('the history log', () => {
    async function finishSync(runner, child, message) {
        child.emit('message', message)
        child.emit('close', 0)
        await new Promise(resolve => setImmediate(resolve))
    }

    // json.set is called for the `last` key first, then the history array.
    function storedHistory() {
        const call = redis.json.set.mock.calls.find(([key]) => key.endsWith('sync:history'))
        return call ? call[2] : null
    }

    test('prepends the newest run', async () => {
        redis.json.get.mockResolvedValue([{ triggeredBy: 'older', ok: true }])
        const child = makeChild()
        spawn.mockReturnValueOnce(child)
        const runner = loadRunner()

        runner.startSync({ triggeredBy: 'Katy' })
        await finishSync(runner, child, { type: 'result', created: 2, updated: 5, totalCards: 900, seconds: 3 })

        const history = storedHistory()
        expect(history).toHaveLength(2)
        expect(history[0]).toMatchObject({ triggeredBy: 'Katy', created: 2, updated: 5, ok: true })
        expect(history[1]).toMatchObject({ triggeredBy: 'older' })
    })

    test('keeps at most 20 entries', async () => {
        redis.json.get.mockResolvedValue(
            Array.from({ length: 20 }, (unused, index) => ({ triggeredBy: 'run' + index, ok: true })))
        const child = makeChild()
        spawn.mockReturnValueOnce(child)
        const runner = loadRunner()

        runner.startSync({ triggeredBy: 'newest' })
        await finishSync(runner, child, { type: 'result', created: 0, updated: 0, totalCards: 900, seconds: 1 })

        const history = storedHistory()
        expect(history).toHaveLength(20)
        expect(history[0].triggeredBy).toBe('newest')
        expect(history[19].triggeredBy).toBe('run18')
    })

    test('records failures too, so a bad run is visible in the log', async () => {
        redis.json.get.mockResolvedValue([])
        const child = makeChild()
        spawn.mockReturnValueOnce(child)
        const runner = loadRunner()

        runner.startSync({ triggeredBy: 'Katy' })
        child.emit('message', { type: 'error', text: 'kards.com returned no cards' })
        child.emit('close', 1)
        await new Promise(resolve => setImmediate(resolve))

        expect(storedHistory()[0]).toMatchObject({ ok: false, error: 'kards.com returned no cards' })
    })

    test('unwraps a JSONPath-wrapped array from redis', async () => {
        redis.json.get.mockResolvedValue([[{ triggeredBy: 'wrapped', ok: true }]])
        const runner = loadRunner()

        await expect(runner.getSyncHistory()).resolves.toEqual([{ triggeredBy: 'wrapped', ok: true }])
    })
})

describe('live progress', () => {
    test('exposes the latest status line while running', async () => {
        const child = makeChild()
        spawn.mockReturnValueOnce(child)
        const runner = loadRunner()

        runner.startSync()
        expect((await runner.getSyncState()).progress).toBe('Starting…')

        child.emit('message', { type: 'progress', text: '900 / 1613 cards checked — 0 created, 2 updated' })

        expect((await runner.getSyncState()).progress).toBe('900 / 1613 cards checked — 0 created, 2 updated')
    })

    test('clears the progress once the sync is done', async () => {
        const child = makeChild()
        spawn.mockReturnValueOnce(child)
        const runner = loadRunner()

        runner.startSync()
        child.emit('message', { type: 'progress', text: 'halfway' })
        child.emit('close', 0)
        await new Promise(resolve => setImmediate(resolve))

        expect((await runner.getSyncState()).progress).toBeNull()
    })
})

describe('getSyncState', () => {
    test('reports an idle runner with no history', async () => {
        const runner = loadRunner()

        await expect(runner.getSyncState()).resolves.toEqual({
            running: false,
            startedAt: null,
            progress: null,
            last: null,
            history: [],
        })
    })

    test('reports the running sync and the stored result', async () => {
        redis.json.get.mockResolvedValueOnce({ ok: true, created: 2, updated: 3 })
        spawn.mockReturnValueOnce(makeChild())
        const runner = loadRunner()
        runner.startSync()

        const state = await runner.getSyncState()

        expect(state.running).toBe(true)
        expect(state.startedAt).toEqual(expect.any(String))
        expect(state.last).toEqual({ ok: true, created: 2, updated: 3 })
    })

    test('survives redis being unavailable', async () => {
        redis.json.get.mockRejectedValueOnce(new Error('no redis'))
        const runner = loadRunner()

        await expect(runner.getSyncState()).resolves.toMatchObject({ running: false, last: null })
    })
})
