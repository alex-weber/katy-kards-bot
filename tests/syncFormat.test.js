// The single source of truth for the sync widget's strings: system.pug prints
// them server-side and src/js/system.js prints the same ones on every poll.

const {
    buildSyncView,
    formatSyncDuration,
    formatSyncKicker,
    formatSyncOutcome,
    formatSyncStatus,
} = require('../src/tools/syncFormat')

describe('formatSyncDuration', () => {
    test('shows seconds with one decimal below a minute', () => {
        expect(formatSyncDuration(2.53)).toBe('2.5s')
    })

    test('switches to minutes and seconds above one', () => {
        expect(formatSyncDuration(187)).toBe('3m 7s')
    })

    test('dashes out a missing or zero duration', () => {
        expect(formatSyncDuration(0)).toBe('–')
        expect(formatSyncDuration(undefined)).toBe('–')
        expect(formatSyncDuration('not a number')).toBe('–')
    })
})

describe('formatSyncOutcome', () => {
    test('counts what changed', () => {
        expect(formatSyncOutcome({ok: true, created: 2, updated: 5})).toBe('2 created, 5 updated')
    })

    test('says so when a run changed nothing', () => {
        expect(formatSyncOutcome({ok: true, created: 0, updated: 0, totalCards: 917}))
            .toBe('No changes (917 checked)')
    })

    test('carries the error of a failed run', () => {
        expect(formatSyncOutcome({ok: false, error: 'kards.com returned no cards'}))
            .toBe('Failed: kards.com returned no cards')
    })

    test('still reads as a failure without an error text', () => {
        expect(formatSyncOutcome({ok: false})).toBe('Failed: unknown error')
    })
})

describe('formatSyncStatus', () => {
    test('prefers the running sync progress line', () => {
        expect(formatSyncStatus({running: true, progress: '400 / 917 cards checked'}))
            .toBe('400 / 917 cards checked')
    })

    test('falls back to the start time until the first progress arrives', () => {
        expect(formatSyncStatus({running: true, startedAt: '2026-07-25T09:13:00Z'}))
            .toMatch(/^Running since .*2026/)
    })

    test('reports how much the last run checked', () => {
        expect(formatSyncStatus({last: {finishedAt: 'x', ok: true, totalCards: 917}}))
            .toBe('917 cards checked')
    })

    test('reports a failure', () => {
        expect(formatSyncStatus({last: {finishedAt: 'x', ok: false, error: 'boom'}}))
            .toBe('Last sync failed: boom')
    })

    test('says when nothing has ever run', () => {
        expect(formatSyncStatus({last: null})).toBe('Never run on this server.')
    })
})

describe('formatSyncKicker', () => {
    test('marks a sync in flight', () => {
        expect(formatSyncKicker({running: true, last: {triggeredBy: 'Katy'}})).toBe('in progress')
    })

    test('credits whoever ran the last one', () => {
        expect(formatSyncKicker({last: {triggeredBy: 'Katy'}})).toBe('last run by Katy')
    })

    test('stays empty with nothing to say', () => {
        expect(formatSyncKicker({last: null})).toBe('')
    })
})

describe('buildSyncView', () => {
    test('decorates the last run and every history entry', () => {
        const view = buildSyncView({
            running: false,
            startedAt: null,
            last: {finishedAt: '2026-07-25T09:14:00Z', ok: true, created: 4, updated: 11,
                totalCards: 917, seconds: 42.5, triggeredBy: 'Katy'},
            history: [{finishedAt: '2026-07-25T09:14:00Z', ok: true, created: 4, updated: 11,
                totalCards: 917, seconds: 42.5, triggeredBy: 'Katy'}],
        })

        expect(view.last).toMatchObject({
            created: 4,
            duration: '42.5s',
            outcome: '4 created, 11 updated',
        })
        expect(view.last.executed).toContain('2026')
        expect(view.history[0].duration).toBe('42.5s')
        expect(view.status).toBe('917 cards checked')
        expect(view.kicker).toBe('last run by Katy')
    })

    // getSyncState() hands back last: null before the first run, and the
    // template reads the same view whether or not Redis had anything.
    test('holds up with nothing stored at all', () => {
        expect(buildSyncView({})).toEqual({
            running: false,
            startedAt: null,
            progress: null,
            kicker: '',
            status: 'Never run on this server.',
            last: null,
            history: [],
        })
    })

    test('drops a last run that never finished', () => {
        expect(buildSyncView({last: {ok: true, created: 1}}).last).toBeNull()
    })
})
