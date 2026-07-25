// Turns the raw sync state (see syncRunner.getSyncState) into the strings the
// system page shows.
//
// It lives on the server because the widget is rendered twice: once by
// system.pug so the panel reads correctly with JavaScript disabled, and again
// by src/js/system.js on every poll. Both now print the same pre-built strings
// instead of each carrying its own copy of the same formatting rules. The one
// thing the browser still formats itself is timestamps — it renders them in the
// viewer's timezone, which the server cannot do.

const emptyValue = '–'

/**
 * '42.5s' / '3m 7s', or a dash when nothing ran.
 *
 * @param seconds
 * @returns {string}
 */
function formatSyncDuration(seconds) {
    const value = Number(seconds) || 0
    if (!value) return emptyValue
    if (value < 60) return value.toFixed(1) + 's'

    return Math.floor(value / 60) + 'm ' + Math.round(value % 60) + 's'
}

/**
 * UTC fallback for a timestamp; the browser re-renders these in local time.
 *
 * @param value ISO timestamp
 * @returns {string}
 */
function formatSyncTime(value) {
    const date = new Date(value)

    return !value || Number.isNaN(date.getTime()) ? emptyValue : date.toUTCString()
}

/**
 * What a finished run did, for the log table's Result column.
 *
 * @param entry stored sync result
 * @returns {string}
 */
function formatSyncOutcome(entry) {
    if (!entry.ok) return 'Failed: ' + (entry.error || 'unknown error')
    if (!entry.created && !entry.updated) return 'No changes (' + (entry.totalCards || 0) + ' checked)'

    return entry.created + ' created, ' + entry.updated + ' updated'
}

/**
 * The line next to the Sync now button: what the child process is doing, or how
 * the last run went.
 *
 * @param state raw sync state
 * @returns {string}
 */
function formatSyncStatus(state) {
    if (state.running) return state.progress || 'Running since ' + formatSyncTime(state.startedAt)

    const last = state.last
    if (!last || !last.finishedAt) return 'Never run on this server.'

    return last.ok
        ? (last.totalCards || 0) + ' cards checked'
        : 'Last sync failed: ' + (last.error || 'unknown error')
}

/**
 * The small text in the panel header.
 *
 * @param state raw sync state
 * @returns {string}
 */
function formatSyncKicker(state) {
    if (state.running) return 'in progress'

    return state.last && state.last.triggeredBy ? 'last run by ' + state.last.triggeredBy : ''
}

/**
 * A finished run plus its display strings.
 *
 * @param entry stored sync result
 * @returns {object}
 */
function buildSyncEntry(entry) {
    return {
        ...entry,
        duration: formatSyncDuration(entry.seconds),
        executed: formatSyncTime(entry.finishedAt),
        outcome: formatSyncOutcome(entry),
    }
}

/**
 * Everything the widget draws, in one object — handed to system.pug as the
 * `sync` local and returned as-is by the /system/sync endpoints.
 *
 * @param state raw sync state
 * @returns {object}
 */
function buildSyncView(state = {}) {
    const last = state.last && state.last.finishedAt ? buildSyncEntry(state.last) : null

    return {
        running: Boolean(state.running),
        startedAt: state.startedAt || null,
        progress: state.progress || null,
        kicker: formatSyncKicker(state),
        status: formatSyncStatus(state),
        last,
        history: (state.history || []).map(buildSyncEntry),
    }
}

module.exports = {
    buildSyncEntry,
    buildSyncView,
    formatSyncDuration,
    formatSyncKicker,
    formatSyncOutcome,
    formatSyncStatus,
    formatSyncTime,
}
