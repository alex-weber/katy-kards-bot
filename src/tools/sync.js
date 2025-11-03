const { createCard, disconnect, getCardStatsMessage } = require('../database/db')
const { getCards } = require("./search")

const batchSize = process.env.SYNC_BATCH_SIZE || 5
/**
 * Process an array of items in batches with limited concurrency
 * @param {Array} items
 * @param {number} batchSize
 * @param {function} handler async function to process each item
 */
async function processInBatches(items, batchSize, handler) {
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize)
        await Promise.all(batch.map(handler))
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
        if (!cards.length) return false

        const message = cards.length + ' cards total -> checking for changes...'
        console.log(message)
        if (process.send) process.send(message)

        // process cards in batches
        await processInBatches(cards, batchSize, async (cardItem) => {
            let card = cardItem.node
            if (card) {
                card.language = language
                await createCard(card)
            }
        })

        const info = getCardStatsMessage()
        const totalTime = (Date.now() - startTime) / 1000
        if (process.send) process.send(info + ' \nProcess time: ' + totalTime + ' seconds.')
        console.log(info)
        console.timeEnd('db_sync')


    } catch (e) {
        console.error('Error during sync:', e)
        return false
    }

    await disconnect()
    return true
}

// update all cards
syncDB().catch(console.error)
