// Tests for the deck render dedup + copy orchestration (createDeckRenderer in
// src/tools/deckRenderer.js). The real canvas render, file copy, counters and
// redis client are all injected, so none of those side effects run here.

// Keep `require`-time side effects (redis connection, counters) out of the
// unit under test.
jest.mock('../src/controller/redis', () => ({ redis: {} }))
jest.mock('../src/tools/screenshotStats', () => ({
    incrementScreenshotCounters: jest.fn(async () => {}),
}))

const { createDeckRenderer } = require('../src/tools/deckRenderer')

// A render stub whose resolution the test controls.
function deferredRender() {
    const calls = []
    const render = jest.fn((input, language, filename) => {
        let resolve
        const promise = new Promise(r => { resolve = r })
        calls.push({ input, language, filename, resolve })
        return promise
    })
    return { render, calls }
}

function makeRenderer(overrides = {}) {
    let n = 0
    return createDeckRenderer({
        concurrency: 2,
        render: jest.fn(async () => true),
        copyFiles: jest.fn(name => name + '_copy'),
        incrementCounters: jest.fn(async () => {}),
        redis: {},
        newFilename: () => 'deck_' + (++n),
        ...overrides,
    })
}

// let queued tasks start
const tick = () => new Promise(r => setImmediate(r))

describe('createDeckRenderer dedup + copy', () => {
    test('renders into a fresh filename and resolves to it', async () => {
        const render = jest.fn(async () => true)
        const renderer = makeRenderer({ render })

        await expect(renderer.renderDeck('code', 'en')).resolves.toBe('deck_1')
        expect(render).toHaveBeenCalledWith('code', 'en', 'deck_1')
    })

    test('coalesces concurrent requests for the same deck into one render', async () => {
        const { render, calls } = deferredRender()
        const copyFiles = jest.fn(name => name + '_copy')
        const incrementCounters = jest.fn(async () => {})
        const renderer = makeRenderer({ render, copyFiles, incrementCounters })

        const originator = renderer.renderDeck('deck-A', 'en')
        const coalesced = renderer.renderDeck('deck-A', 'en')
        await tick()

        expect(render).toHaveBeenCalledTimes(1)

        calls[0].resolve(true)
        const [first, second] = await Promise.all([originator, coalesced])

        // originator gets the real files; the coalesced caller gets a copy
        expect(first).toBe('deck_1')
        expect(second).toBe('deck_1_copy')
        expect(copyFiles).toHaveBeenCalledTimes(1)
        expect(copyFiles).toHaveBeenCalledWith('deck_1')
        // one render, one count
        expect(incrementCounters).toHaveBeenCalledTimes(1)
        expect(incrementCounters).toHaveBeenCalledWith({})
    })

    test('the same deck in another language is a separate render', async () => {
        const render = jest.fn(async () => true)
        const renderer = makeRenderer({ render })

        await Promise.all([
            renderer.renderDeck('deck-L', 'en'),
            renderer.renderDeck('deck-L', 'de'),
        ])

        expect(render).toHaveBeenCalledTimes(2)
    })

    test('a failed render yields false for every caller and skips the copy', async () => {
        const render = jest.fn(async () => false)
        const copyFiles = jest.fn()
        const incrementCounters = jest.fn(async () => {})
        const renderer = makeRenderer({ render, copyFiles, incrementCounters })

        const results = await Promise.all([
            renderer.renderDeck('deck-B', 'en'),
            renderer.renderDeck('deck-B', 'en'),
        ])

        expect(results).toEqual([false, false])
        expect(render).toHaveBeenCalledTimes(1)
        expect(copyFiles).not.toHaveBeenCalled()
        expect(incrementCounters).not.toHaveBeenCalled()
    })

    test('a render that throws resolves to false', async () => {
        const render = jest.fn(async () => { throw new Error('boom') })
        const error = jest.spyOn(console, 'error').mockImplementation(() => {})
        const renderer = makeRenderer({ render })

        await expect(renderer.renderDeck('deck-T', 'en')).resolves.toBe(false)
        error.mockRestore()
    })

    test('a failing counter update does not sink a good render', async () => {
        const incrementCounters = jest.fn(async () => { throw new Error('redis down') })
        const error = jest.spyOn(console, 'error').mockImplementation(() => {})
        const renderer = makeRenderer({ incrementCounters })

        await expect(renderer.renderDeck('deck-R', 'en')).resolves.toBe('deck_1')
        await tick()
        error.mockRestore()
    })

    test('a request after completion starts a fresh render (no stale coalescing)', async () => {
        const render = jest.fn(async () => true)
        const copyFiles = jest.fn()
        const renderer = makeRenderer({ render, copyFiles })

        const first = await renderer.renderDeck('deck-C', 'en')
        const second = await renderer.renderDeck('deck-C', 'en')

        expect(first).toBe('deck_1')
        expect(second).toBe('deck_2')
        expect(render).toHaveBeenCalledTimes(2)
        expect(copyFiles).not.toHaveBeenCalled()
    })

    test('no more than `concurrency` renders run at once', async () => {
        const { render, calls } = deferredRender()
        const renderer = makeRenderer({ render, concurrency: 2 })

        const pending = ['x', 'y', 'z'].map(d => renderer.renderDeck(d, 'en'))
        await tick()
        expect(render).toHaveBeenCalledTimes(2)

        calls[0].resolve(true)
        await tick()
        expect(render).toHaveBeenCalledTimes(3)

        calls[1].resolve(true)
        calls[2].resolve(true)
        await expect(Promise.all(pending)).resolves.toEqual(['deck_1', 'deck_2', 'deck_3'])
    })
})
