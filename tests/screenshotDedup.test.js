// Tests for the screenshot dedup + copy orchestration (createScreenshotTaker in
// src/tools/puppeteer.js). The real browser capture, file copy, counters and
// redis client are all injected, so none of those side effects run here.

// Keep `require`-time side effects (redis connection, puppeteer-core, counters)
// out of the unit under test.
jest.mock('../src/controller/redis', () => ({ redis: {} }))
jest.mock('../src/tools/screenshotStats', () => ({
    incrementScreenshotCounters: jest.fn(async () => {}),
}))
jest.mock('puppeteer-core', () => ({}))

const { createScreenshotTaker } = require('../src/tools/puppeteer')

// A capture stub whose resolution the test controls.
function deferredCapture() {
    const calls = []
    const capture = jest.fn((url, key) => {
        let resolve
        const promise = new Promise(r => { resolve = r })
        calls.push({ url, key, resolve })
        return promise
    })
    return { capture, calls }
}

function makeTaker(overrides = {}) {
    return createScreenshotTaker({
        keys: ['k1'],
        concurrency: 2,
        capture: jest.fn(async () => 'deck_real'),
        copyFiles: jest.fn(name => name + '_copy'),
        incrementCounters: jest.fn(async () => {}),
        redis: {},
        ...overrides,
    })
}

describe('createScreenshotTaker dedup + copy', () => {
    test('no keys configured short-circuits to false without capturing', async () => {
        const capture = jest.fn(async () => 'deck_1')
        const taker = makeTaker({ keys: [], capture })
        await expect(taker.takeScreenshot('u')).resolves.toBe(false)
        expect(capture).not.toHaveBeenCalled()
    })

    test('coalesces concurrent requests for the same deck into one capture', async () => {
        const { capture, calls } = deferredCapture()
        const copyFiles = jest.fn(name => name + '_copy')
        const incrementCounters = jest.fn(async () => {})
        const taker = makeTaker({ capture, copyFiles, incrementCounters })

        const originator = taker.takeScreenshot('deck-A')
        const coalesced = taker.takeScreenshot('deck-A')

        // only one browser job was started for the duplicate request
        expect(capture).toHaveBeenCalledTimes(1)

        calls[0].resolve('deck_1')
        const [first, second] = await Promise.all([originator, coalesced])

        // originator gets the real file; the coalesced caller gets a private copy
        expect(first).toBe('deck_1')
        expect(second).toBe('deck_1_copy')
        expect(copyFiles).toHaveBeenCalledTimes(1)
        expect(copyFiles).toHaveBeenCalledWith('deck_1')
        // the counter only counts the single real capture, but includes both
        // generated screenshot files for Browserless usage tracking
        expect(incrementCounters).toHaveBeenCalledTimes(1)
        expect(incrementCounters).toHaveBeenCalledWith({}, 2)
    })

    test('a failed capture yields false for every caller and skips the copy', async () => {
        const capture = jest.fn(async () => false)
        const copyFiles = jest.fn()
        const incrementCounters = jest.fn(async () => {})
        const taker = makeTaker({ capture, copyFiles, incrementCounters })

        const [first, second] = await Promise.all([
            taker.takeScreenshot('deck-B'),
            taker.takeScreenshot('deck-B'),
        ])

        expect(first).toBe(false)
        expect(second).toBe(false)
        expect(capture).toHaveBeenCalledTimes(1)
        expect(copyFiles).not.toHaveBeenCalled()
        expect(incrementCounters).not.toHaveBeenCalled()
    })

    test('a request after completion starts a fresh capture (no stale coalescing)', async () => {
        let n = 0
        const capture = jest.fn(async () => 'deck_' + (++n))
        const copyFiles = jest.fn(name => name + '_copy')
        const taker = makeTaker({ capture, copyFiles })

        const first = await taker.takeScreenshot('deck-C')
        const second = await taker.takeScreenshot('deck-C')

        expect(first).toBe('deck_1')
        expect(second).toBe('deck_2')
        expect(capture).toHaveBeenCalledTimes(2)
        expect(copyFiles).not.toHaveBeenCalled()
    })

    test('different decks run as independent captures', async () => {
        const { capture, calls } = deferredCapture()
        const taker = makeTaker({ capture })

        const a = taker.takeScreenshot('deck-X')
        const b = taker.takeScreenshot('deck-Y')

        expect(capture).toHaveBeenCalledTimes(2)
        calls[0].resolve('deck_x')
        calls[1].resolve('deck_y')
        await expect(a).resolves.toBe('deck_x')
        await expect(b).resolves.toBe('deck_y')
    })

    test('duplicate Browserless key values keep independent slots', async () => {
        const { capture, calls } = deferredCapture()
        const taker = makeTaker({
            keys: [
                {name: 'BROWSERLESS_API_KEY_2', value: 'same-key'},
                {name: 'BROWSERLESS_API_KEY_3', value: 'same-key'},
            ],
            concurrency: 1,
            capture,
        })

        const first = taker.takeScreenshot('deck-1')
        const second = taker.takeScreenshot('deck-2')

        expect(capture).toHaveBeenCalledTimes(2)
        expect(capture).toHaveBeenNthCalledWith(1, 'deck-1', 'same-key')
        expect(capture).toHaveBeenNthCalledWith(2, 'deck-2', 'same-key')

        calls[0].resolve('deck_1')
        calls[1].resolve('deck_2')
        await expect(first).resolves.toBe('deck_1')
        await expect(second).resolves.toBe('deck_2')
    })
})
