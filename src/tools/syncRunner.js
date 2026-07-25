// Owns the kards.com DB sync: spawning it, keeping two of them from running at
// once, and remembering how the last one went.
//
// The sync stays a child process rather than an in-process call. It pulls the
// full card list (10k+) into memory, and src/tools/sync.js ends by calling
// disconnect() — in-process that would tear down the Prisma client the web app
// and the bot share.
//
// The system page's Sync now button is the only way in. Everything runs in one
// process (see index.js), so the running-flag below is a real lock: two admins
// clicking at the same moment still get a single sync.
const path = require('path')
const {spawn} = require('child_process')
const {redis, cachePrefix} = require('../controller/redis')

const lastSyncKey = `${cachePrefix}system:sync:last`
const syncHistoryKey = `${cachePrefix}system:sync:history`
const syncScript = path.join(__dirname, 'sync.js')

// How many past runs the system page's log table keeps.
const syncHistoryLimit = parseInt(process.env.SYNC_HISTORY_LIMIT, 10) || 20

// A real sync runs in seconds; this only exists so a child that hangs (or never
// exits) can't leave the running flag — and the page's button — stuck forever.
const syncTimeoutMs = parseInt(process.env.SYNC_TIMEOUT_MS, 10) || 15 * 60 * 1000

// Absent while idle; holds {startedAt, child} for the duration of a run.
let activeSync = null

/**
 * @returns {boolean}
 */
function isSyncRunning() {
    return activeSync !== null
}

/**
 * A stored value, or null when Redis is unavailable or has nothing.
 *
 * @param key
 * @param redisClient
 * @returns {Promise<*>}
 */
async function readStored(key, redisClient) {
    if (!redisClient?.json?.get) return null

    // redis.json.get(key, '$') hands back the stored value directly.
    return await redisClient.json.get(key, '$').catch(() => null)
}

/**
 * The last finished run, or null if none has finished since the last Redis
 * flush. Shape mirrors what saveLastSync() writes.
 *
 * @param redisClient
 * @returns {Promise<object|null>}
 */
async function getLastSync(redisClient = redis) {
    return await readStored(lastSyncKey, redisClient) || null
}

/**
 * Past runs, newest first, for the log table. Capped at syncHistoryLimit.
 *
 * @param redisClient
 * @returns {Promise<object[]>}
 */
async function getSyncHistory(redisClient = redis) {
    const saved = await readStored(syncHistoryKey, redisClient)
    // json.get can hand back the array wrapped in the JSONPath match list.
    if (Array.isArray(saved) && saved.length === 1 && Array.isArray(saved[0])) return saved[0]
    return Array.isArray(saved) ? saved : []
}

/**
 * @param result
 * @param redisClient
 * @returns {Promise<object>}
 */
async function saveLastSync(result, redisClient = redis) {
    if (redisClient?.json?.set) {
        await redisClient.json.set(lastSyncKey, '$', result).catch(
            error => console.error('Could not store the sync result', error))

        const history = [result, ...await getSyncHistory(redisClient)].slice(0, syncHistoryLimit)
        await redisClient.json.set(syncHistoryKey, '$', history).catch(
            error => console.error('Could not store the sync history', error))
    }
    return result
}

/**
 * Everything the system page needs to draw the widget.
 *
 * @param redisClient
 * @returns {Promise<{running: boolean, startedAt: (string|null), progress: (string|null),
 *   last: (object|null), history: object[]}>}
 */
async function getSyncState(redisClient = redis) {
    const [last, history] = await Promise.all([
        getLastSync(redisClient),
        getSyncHistory(redisClient),
    ])

    return {
        running: isSyncRunning(),
        startedAt: activeSync ? activeSync.startedAt : null,
        progress: activeSync ? activeSync.progress : null,
        last,
        history,
    }
}

/**
 * Spawn a sync unless one is already in flight.
 *
 * Returns as soon as the child is spawned — a full sync takes minutes, far
 * longer than a request should wait. The page follows it via getSyncState().
 *
 * @param triggeredBy the admin the run is logged under
 * @param redisClient
 * @returns {{started: boolean, reason?: string}}
 */
function startSync({triggeredBy = 'unknown', redisClient = redis} = {}) {
    if (isSyncRunning()) return {started: false, reason: 'A sync is already running'}

    const startedAt = new Date().toISOString()
    const startTime = Date.now()
    // The child only reports a `result` message once it has actually written
    // the cards, so its absence — not the exit code — is what marks a failure.
    let result = null
    let errorText = null

    let child
    try {
        child = spawn(process.execPath, [syncScript], {stdio: ['inherit', 'inherit', 'inherit', 'ipc']})
    } catch (error) {
        console.error('Could not spawn the DB sync', error)
        return {started: false, reason: 'Could not start the sync process'}
    }

    // `progress` carries the child's latest status line to the widget, so a run
    // shows what it is doing rather than just a spinner.
    activeSync = {startedAt, child, progress: 'Starting…'}
    console.time('db_sync')

    const watchdog = setTimeout(() => {
        errorText = `Sync timed out after ${Math.round(syncTimeoutMs / 1000)}s and was stopped`
        console.error(errorText)
        // SIGKILL rather than SIGTERM: the point is to guarantee the 'close'
        // that releases the lock, and a wedged child may ignore SIGTERM.
        child.kill('SIGKILL')
    }, syncTimeoutMs)
    if (typeof watchdog.unref === 'function') watchdog.unref()

    child.on('message', message => {
        const {type, text} = message || {}
        if (type === 'result') result = message
        if (type === 'error') errorText = text
        if (text && activeSync) activeSync.progress = text
    })

    child.on('error', error => {
        console.error(error)
        errorText = 'DB sync error. Check log for details.'
    })

    child.on('close', async code => {
        console.timeEnd('db_sync')
        clearTimeout(watchdog)
        activeSync = null

        const ok = Boolean(result) && code === 0
        await saveLastSync({
            finishedAt: new Date().toISOString(),
            startedAt,
            ok,
            created: result ? result.created : 0,
            updated: result ? result.updated : 0,
            totalCards: result ? result.totalCards : 0,
            seconds: Number(((Date.now() - startTime) / 1000).toFixed(3)),
            triggeredBy,
            error: ok ? null : (errorText || `Sync exited with code ${code}`),
        }, redisClient)
    })

    return {started: true}
}

module.exports = {
    getLastSync,
    getSyncHistory,
    getSyncState,
    isSyncRunning,
    saveLastSync,
    startSync,
}
