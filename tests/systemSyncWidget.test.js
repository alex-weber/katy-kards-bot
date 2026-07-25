// Renders src/views/system.pug and checks the sync widget reads correctly with
// JavaScript disabled — system.js re-renders the same fields on load, so a
// regression here is invisible in the browser but breaks the no-JS view.

const path = require('path')
const pug = require('pug')
const {buildSyncView} = require('../src/tools/syncFormat')

const template = pug.compileFile(path.join(__dirname, '../src/views/system.pug'))

const baseLocals = {
    title: 'System',
    user: {username: 'Katy', role: 'VIP', isManager: true},
    _csrf: 'token',
    currentPath: '/system',
    memory: {
        current: {rss: 148, heapUsed: 61, heapTotal: 89, arrayBuffers: 12},
        peak24h: {rss: 190}, availableMb: 562, availableHuman: '562 MB',
        samples: [], sampleSpan: {human: '10h'}, jump: {detected: false},
        thresholdMb: 512, thresholdExceeded: false, availableExceeded: false,
    },
    redisStats: {
        available: true,
        cache: {hitRatio: 87, hits: 8740, misses: 1260, missRatio: 13, total: 10000,
            evictedKeys: 4, expiredKeys: 311, instantaneousOpsPerSec: 6},
        memory: {availableMb: 30, availableHuman: '30 MB', usedMemoryHuman: '18M',
            usedMemoryRssHuman: '21M', usedMemoryPeakHuman: '24M', memFragmentationRatio: 1.14},
        general: {redisVersion: '7.2.0', role: 'master', uptimeHuman: '12d', connectedClients: 3},
    },
}

// The template is handed the same view the router builds, never the raw state.
function render(sync) {
    return template({...baseLocals, sync: buildSyncView(sync)})
}

// The value of a <div id="…"> stat card.
function statValue(html, id) {
    const match = html.match(new RegExp(`id="${id}">([^<]*)<`))
    return match ? match[1] : null
}

test('shows the counts of the last successful sync', () => {
    const html = render({
        running: false,
        startedAt: null,
        last: {
            finishedAt: '2026-07-25T09:14:00Z', ok: true, created: 4, updated: 11,
            totalCards: 917, seconds: 42.5, triggeredBy: 'Katy', error: null,
        },
    })

    expect(statValue(html, 'syncCreated')).toBe('4')
    expect(statValue(html, 'syncUpdated')).toBe('11')
    expect(statValue(html, 'syncDuration')).toBe('42.5s')
    expect(statValue(html, 'syncLastRun')).toContain('2026')
    expect(html).toContain('917 cards checked')
    expect(html).toContain('last run by Katy')
})

test('formats a long sync in minutes', () => {
    const html = render({running: false, startedAt: null, last: {finishedAt: 'x', ok: true, seconds: 187}})

    expect(statValue(html, 'syncDuration')).toBe('3m 7s')
})

test('says so when no sync has ever run', () => {
    const html = render({running: false, startedAt: null, last: null})

    expect(statValue(html, 'syncCreated')).toBe('–')
    expect(statValue(html, 'syncDuration')).toBe('–')
    expect(html).toContain('Never run on this server.')
})

test('surfaces the error of a failed sync', () => {
    const html = render({
        running: false, startedAt: null,
        last: {finishedAt: '2026-07-25T09:14:00Z', ok: false, created: 0, updated: 0,
            seconds: 3, error: 'kards.com returned no cards'},
    })

    expect(html).toContain('Last sync failed: kards.com returned no cards')
})

test('disables the button while a sync is running', () => {
    const html = render({running: true, startedAt: '2026-07-25T09:13:00Z', last: null})

    expect(html).toMatch(/id="syncButton"[^>]*disabled/)
    expect(html).toContain('Syncing')
    expect(html).toContain('in progress')
})

test('leaves the button usable when idle', () => {
    const html = render({running: false, startedAt: null, last: null})

    expect(html).toMatch(/id="syncButton"(?![^>]*disabled)/)
    expect(html).toContain('Sync now')
})

test('renders without a sync local at all', () => {
    expect(() => template(baseLocals)).not.toThrow()
})

describe('the history log table', () => {
    // The text of each cell of each row, read out of the rendered <tbody>. The
    // cell text is taken from the capture group rather than by stripping tags
    // out of the match: it is already matched as "no < in it", so there is
    // nothing left to strip.
    function historyRows(html) {
        const body = html.match(/<tbody id="syncHistoryBody">([\s\S]*?)<\/tbody>/)
        if (!body) return []

        return body[1].split('<tr>').slice(1).map(
            row => [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(cell => cell[1]))
    }

    test('lists who ran each sync, when, and what it did', () => {
        const html = render({
            running: false, startedAt: null, last: null,
            history: [
                {triggeredBy: 'Katy', finishedAt: '2026-07-25T09:14:00Z', ok: true,
                    created: 2, updated: 5, totalCards: 917, seconds: 2.8},
                {triggeredBy: 'Tim', finishedAt: '2026-07-24T08:00:00Z', ok: true,
                    created: 0, updated: 0, totalCards: 917, seconds: 1.4},
            ],
        })

        const rows = historyRows(html)
        expect(rows).toHaveLength(2)
        expect(rows[0][0]).toBe('Katy')
        expect(rows[0][2]).toBe('2.8s')
        expect(rows[0][3]).toBe('2 created, 5 updated')
        expect(rows[1][0]).toBe('Tim')
        expect(rows[1][3]).toBe('No changes (917 checked)')
    })

    test('marks a failed run and shows its error', () => {
        const html = render({
            running: false, startedAt: null, last: null,
            history: [{triggeredBy: 'Katy', finishedAt: '2026-07-25T09:14:00Z', ok: false,
                seconds: 0.4, error: 'kards.com returned no cards'}],
        })

        expect(historyRows(html)[0][3]).toBe('Failed: kards.com returned no cards')
        expect(html).toContain('system-sync-failed')
    })

    test('says so when nothing has been recorded', () => {
        const html = render({running: false, startedAt: null, last: null, history: []})

        expect(historyRows(html)).toHaveLength(0)
        expect(html).toContain('No syncs recorded yet.')
    })

    test('hides the empty notice once there are entries', () => {
        const html = render({
            running: false, startedAt: null, last: null,
            history: [{triggeredBy: 'Katy', finishedAt: '2026-07-25T09:14:00Z', ok: true,
                created: 1, updated: 0, totalCards: 900, seconds: 2}],
        })

        expect(html).toMatch(/id="syncHistoryEmpty"[^>]*hidden/)
    })
})
