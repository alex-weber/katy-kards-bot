const fs = require('fs')
const RequestQueue = require('./queue')
const {redis} = require('../controller/redis')
const {incrementScreenshotCounters} = require('./screenshotStats')
const {getDeckFiles} = require('./fileManager')

//how many decks are drawn at the same time; each one holds a few canvases and
//the decoded card art in memory
const renderConcurrency = parseInt(process.env.DECK_RENDER_CONCURRENCY) || 4

/**
 * Build the deck image dispatcher. Every side-effecting collaborator is
 * injected, so the dedup + copy orchestration can be unit-tested without
 * canvas, Redis, or the filesystem.
 *
 * @param concurrency       decks drawn at once
 * @param render            (input, language, filename) => Promise<boolean>
 * @param copyFiles         (filename) => string|false, clones a render's files
 * @param incrementCounters (redis) => Promise, bumps the deck image counters
 * @param redis             redis client handed to incrementCounters
 * @param newFilename       () => string, a fresh base name for a render
 * @returns {{renderDeck: function(string, string): Promise<string|false>}}
 */
function createDeckRenderer({
    concurrency = 4,
    render,
    copyFiles,
    incrementCounters,
    redis,
    newFilename = deckFilename,
}) {
    const queue = new RequestQueue(concurrency)
    //renders currently queued or running, keyed by deck and language, so a
    //duplicate request for the same deck reuses the running job
    const inFlight = new Map()

    /**
     * Queue a deck render. If the very same deck is already queued or being
     * drawn, the running job is reused; the coalesced caller gets a private
     * copy of the files so it can send and delete them independently of the
     * originator.
     *
     * @param input deck code or kards.com deck link
     * @param language
     * @returns {Promise<string|false>} the base name for getDeckFiles()
     */
    function renderDeck(input, language) {
        const key = `${input}|${language}`
        const running = inFlight.get(key)
        if (running) {
            console.log('reusing in-flight deck render for', input)
            return running.then(filename => filename ? copyFiles(filename) : false)
        }

        const job = enqueueRender(input, language)
        inFlight.set(key, job)
        //stop coalescing onto this job once it settles (success or failure)
        job.finally(() => inFlight.delete(key))

        return job
    }

    /**
     * @param input
     * @param language
     * @returns {Promise<string|false>}
     */
    function enqueueRender(input, language) {
        return new Promise(resolve => {
            queue.enqueue(async () => {
                const filename = newFilename()
                try {
                    const rendered = await render(input, language, filename)
                    if (!rendered) return resolve(false)
                    //counter bookkeeping must never sink a good render, so
                    //failures are logged and swallowed
                    incrementCounters(redis).catch(error =>
                        console.error('Failed to update deck image counters:', error))
                    resolve(filename)
                } catch (error) {
                    console.error('Failed to render deck images:', error)
                    resolve(false)
                }
            })
        })
    }

    return {renderDeck}
}

/**
 * @returns {string}
 */
function deckFilename() {
    return `deck_${Date.now()}_${Math.random().toString(36).substring(7)}`
}

/**
 * Duplicate a finished render's files under a fresh name, so a coalesced
 * request owns its own copy and won't race the originator's cleanup.
 *
 * @param filename
 * @returns {string|false}
 */
function copyDeckFiles(filename) {
    try {
        const copyName = deckFilename()
        const sources = getDeckFiles(filename)
        const targets = getDeckFiles(copyName)
        for (let i = 0; i < sources.length; i++) {
            fs.copyFileSync(sources[i], targets[i])
        }

        return copyName
    } catch (error) {
        console.error('Failed to copy deck files for coalesced request:', error)

        return false
    }
}

//production wiring; deckImage pulls in canvas, sharp and the database, so it
//is loaded on first use rather than with this module
const {renderDeck} = createDeckRenderer({
    concurrency: renderConcurrency,
    render: (...args) => require('./deckImage').renderDeckImages(...args),
    copyFiles: copyDeckFiles,
    incrementCounters: incrementScreenshotCounters,
    redis,
})

module.exports = {renderDeck, createDeckRenderer}
