const { createCard, disconnect, getCardStats, getCardStatsMessage } = require('../database/db')
const { getCards } = require("./search")

const batchSize = process.env.SYNC_BATCH_SIZE || 5

// Sends are async, so they are chained and awaited before the process exits —
// otherwise the final `result` can be dropped on the way out.
let pendingReports = Promise.resolve()

/**
 * Report to whoever spawned this script. Every message is an object with a
 * `type` and a ready-to-print `text`: the Discord command prints the text, the
 * system page widget reads the counters off the final `result` message.
 *
 * @param message
 */
function report(message) {
    if (!process.send) return

    pendingReports = pendingReports.then(() => new Promise(resolve => {
        // The callback also fires on error; a failed report must not stall the exit.
        process.send(message, () => resolve())
    }))
}
/**
 * Process an array of items in batches with limited concurrency
 * @param {Array} items
 * @param {number} batchSize
 * @param {function} handler async function to process each item
 * @param {function} onProgress called with the number of items done so far
 */
async function processInBatches(items, batchSize, handler, onProgress = () => {}) {
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize)
        await Promise.all(batch.map(handler))
        onProgress(Math.min(i + batchSize, items.length))
    }
}

/**
 * @returns {Promise<boolean>}
 */
async function syncDB() {
    const language = 'en'
    console.log('starting DB sync. Batch size is ' + batchSize)
    console.time('db_sync')
    const startTime = Date.now()

    const variables = {
        language,
        q: '',
        showSpawnables: true,
        showReserved: true,
        first: 10000,
    }

    try {
        const response = await getCards(variables, 5000)
        const cards = response.cards
        if (!cards.length) {
            report({type: 'error', text: 'kards.com returned no cards'})
            return false
        }

        const message = cards.length + ' cards total -> checking for changes...'
        console.log(message)
        report({type: 'progress', text: message, totalCards: cards.length})

        // Report progress in 10% steps rather than per batch: with a batch size
        // of 5 that would be hundreds of IPC messages for no extra information.
        const progressStep = Math.max(1, Math.ceil(cards.length / 10))
        let nextProgressAt = progressStep

        // process cards in batches
        await processInBatches(cards, batchSize, async (cardItem) => {
            let card = cardItem.node
            if (card) {
                card.language = language
                await createCard(card)
            }
        }, done => {
            if (done < nextProgressAt && done < cards.length) return
            nextProgressAt = done + progressStep

            const stats = getCardStats()
            report({
                type: 'progress',
                text: `${done} / ${cards.length} cards checked — ${stats.created} created, ${stats.updated} updated`,
                done,
                totalCards: cards.length,
                ...stats,
            })
        })

        const info = getCardStatsMessage()
        const totalTime = (Date.now() - startTime) / 1000
        const stats = getCardStats()
        report({
            type: 'result',
            text: info + ' \nProcess time: ' + totalTime + ' seconds.',
            created: stats.created,
            updated: stats.updated,
            totalCards: cards.length,
            seconds: totalTime,
        })
        console.log(info)
        console.timeEnd('db_sync')


    } catch (e) {
        console.error('Error during sync:', e)
        report({type: 'error', text: 'DB sync error: ' + e.message})
        return false
    }

    await disconnect()
    return true
}

/**
 * End the process once the last report has been flushed.
 *
 * Required, not tidiness: this script imports the shared db/search modules, and
 * src/controller/redis.js opens a Redis connection at import time. That socket
 * keeps the event loop alive indefinitely, so without an explicit exit the
 * process lingers, the parent never sees 'close', and the system page's sync
 * button stays stuck on "Syncing…".
 *
 * @param ok
 * @returns {Promise<void>}
 */
async function finish(ok) {
    await pendingReports
    process.exit(ok ? 0 : 1)
}

// update all cards
syncDB()
    .then(finish)
    .catch(error => {
        console.error(error)
        return finish(false)
    })
