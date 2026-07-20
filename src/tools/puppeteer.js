const fs = require('fs')
const puppeteer = require('puppeteer-core')
const RequestQueue = require('./queue')
const {redis} = require('../controller/redis')
const {incrementScreenshotCounters} = require('./screenshotStats')
const {getDeckFiles} = require('./fileManager')

const browserLessKeys = getBrowserlessKeys()
//how many requests a single Browserless key may handle at the same time
const perKeyConcurrency = parseInt(process.env.SCREENSHOT_CONCURRENCY) || 2

/**
 * Build the screenshot dispatcher. Every side-effecting collaborator is
 * injected, so the dedup + copy orchestration can be unit-tested without a
 * real browser, Redis, or filesystem.
 *
 * @param keys              Browserless API key slots (capacity = keys * concurrency)
 * @param concurrency       requests a single key may handle at once
 * @param capture           (url, key) => Promise<string|false>, the browser job
 * @param copyFiles         (filename) => string|false, clones a capture's files
 * @param incrementCounters (redis, count) => Promise, bumps the screenshot counters
 * @param redis             redis client handed to incrementCounters
 * @returns {{takeScreenshot: function(string): Promise<string|false>}}
 */
function createScreenshotTaker({
    keys,
    concurrency = 2,
    capture,
    copyFiles,
    incrementCounters,
    redis,
}) {
    const keySlots = keys.map((key, index) =>
        typeof key === 'string' ? {name: `Browserless key #${index + 1}`, value: key} : key)
    //in-flight request count per key, so no key is pushed past its limit
    const keyLoad = new Map(keySlots.map(key => [key, 0]))
    //total capacity across all keys; the queue holds the overflow until a slot frees
    const queue = new RequestQueue(keySlots.length * concurrency)
    //captures currently queued or running, keyed by url, so a duplicate request
    //for the same deck reuses the running job instead of launching another browser
    const inFlight = new Map()

    /**
     * Queue a screenshot request. The capture runs as soon as one of the
     * Browserless keys has a free slot; until then it waits in the queue.
     *
     * If the very same deck is already queued or being captured, the running
     * job is reused instead of starting a second browser. The coalesced caller
     * gets a private copy of the files so it can send and delete them
     * independently of the originator.
     *
     * @param url
     * @returns {Promise<string|false>}
     */
    function takeScreenshot(url) {
        if (!keySlots.length) return Promise.resolve(false)

        const running = inFlight.get(url)
        if (running) {
            console.log('reusing in-flight screenshot for', url)
            return running.then(filename => filename ? copyFiles(filename) : false)
        }

        const job = enqueueCapture(url)
        inFlight.set(url, job)
        //stop coalescing onto this job once it settles (success or failure)
        job.finally(() => inFlight.delete(url))

        return job
    }

    /**
     * Queue the actual capture against the least-loaded Browserless key.
     *
     * @param url
     * @returns {Promise<string|false>}
     */
    function enqueueCapture(url) {
        return new Promise(resolve => {
            queue.enqueue(async () => {
                const key = leastLoadedKey()
                keyLoad.set(key, keyLoad.get(key) + 1)
                try {
                    console.log(`Browserless key selected: ${key.name}`)
                    const filename = await capture(url, key.value)
                    if (filename) {
                        //counter bookkeeping must never sink a good screenshot
                        incrementCounters(redis, getDeckFiles(filename).length).catch(error =>
                            console.error('Failed to update screenshot counters:', error))
                    }
                    resolve(filename)
                } catch (error) {
                    console.error('Error:', error)
                    resolve(false)
                } finally {
                    keyLoad.set(key, keyLoad.get(key) - 1)
                }
            })
        })
    }

    /**
     * Pick the Browserless key currently handling the fewest requests. The
     * queue caps total in-flight work at keys * concurrency, so the
     * least-loaded key is always below the per-key limit.
     *
     * @returns {{name: string, value: string}}
     */
    function leastLoadedKey() {
        let chosen = keySlots[0]
        for (const key of keySlots) {
            if (keyLoad.get(key) < keyLoad.get(chosen)) chosen = key
        }

        return chosen
    }

    return {takeScreenshot}
}

//production wiring: real browser capture, file copy, counters and redis client
const {takeScreenshot} = createScreenshotTaker({
    keys: browserLessKeys,
    concurrency: perKeyConcurrency,
    capture: captureScreenshot,
    copyFiles: copyDeckFiles,
    incrementCounters: incrementScreenshotCounters,
    redis,
})

/**
 *
 * @param page
 * @param selector
 * @param filename
 * @returns {Promise<void>}
 */
async function saveScreenshot(page, selector, filename) {

    if (!filename) filename = 'deckScreenshot'
    const outputPath = __dirname+'/../tmp/' + filename
    // Get the bounding box of the element
    const elementHandle = await page.$(selector)
    const boundingBox = await elementHandle.boundingBox()
    const topMargin = 422

    if (boundingBox) {
        // Take 2 screenshots of the deck
        await elementHandle.screenshot({
            path: outputPath+'.webp',
            type: 'webp',
            quality: 100,
            clip: {
                x: 0,
                y: 0,
                width: boundingBox.width - 60,
                height: 383,
            }
        })
        await elementHandle.screenshot({
            path: outputPath+'2.webp',
            type: 'webp',
            quality: 100,
            clip: {
                x: 0,
                y: topMargin,
                width: boundingBox.width - 40,
                height: boundingBox.height - topMargin+5,
            }
        })

    } else {
        console.error(`Element "${selector}" is not visible or not in the viewport.`)
    }

}

/**
 * Duplicate a finished capture's files under a fresh name, so a coalesced
 * request owns its own copy and won't race the originator's cleanup.
 *
 * @param filename
 * @returns {string|false}
 */
function copyDeckFiles(filename) {
    try {
        const copyName = `deck_${Date.now()}_${Math.random().toString(36).substring(7)}`
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

/**
 * Capture the deck screenshots using a specific Browserless key.
 *
 * @param url
 * @param blKey
 * @returns {Promise<string|false>}
 */
async function captureScreenshot(url, blKey) {

    const options = { waitUntil: 'networkidle2' }
    const selector = '.Sidebar_side__scroll__xZp3s'

    const wsHost = process.env.BROWSERLESS_HOST || 'ws://production-ams.browserless.io'
    const timeout = parseInt(process.env.BROWSERLESS_TIMEOUT) || 10000

    const now = new Date().getTime()

    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(7)
    const filename = `deck_${timestamp}_${random}`

    // Connect to Browserless
    try {

        console.time('puppeteerConnect'+now)
        const browser = await connectBrowser(`${wsHost}?token=${blKey}`, timeout)
        console.timeEnd('puppeteerConnect'+now)

        console.log('using Browserless.io Puppeteer service')

        const page = await browser.newPage()
        await page.setViewport({ width: 3000, height:2000 })
        console.time('pageLoading'+now)

        const response = await page.goto(url, options)
        if (!response.status || response.status() > 399)
        {
            await browser.close()
            return false
        }


        console.timeEnd('pageLoading'+now)

        // Wait for the element to appear
        await page.waitForSelector(selector, { timeout: 5000 })
        await saveScreenshot(page, selector, filename)
        await browser.close()

        return filename

    } catch (error) {
        console.error('Error:', error)

        return false
    }

}

function getBrowserlessKeys()
{
    const keys = []
    if (process.env.BROWSERLESS_API_KEY) {
        keys.push({name: 'BROWSERLESS_API_KEY', value: process.env.BROWSERLESS_API_KEY})
    }
    for (let i = 2; i < 10; i++) {
        const name = 'BROWSERLESS_API_KEY_'+i
        if (!process.env[name]) break
        keys.push({name, value: process.env[name]})
    }

    if (keys.length) {
        const duplicateKeys = keys.filter(key =>
            keys.filter(candidate => candidate.value === key.value).length > 1)
        console.log('Browserless keys configured:', keys.map(key => key.name).join(', '))
        if (duplicateKeys.length) {
            console.warn('Duplicate Browserless key values configured for:',
                duplicateKeys.map(key => key.name).join(', '))
        }
    }

    return keys
}

async function connectBrowser(wsEndpoint, timeout = 5000) {
    return Promise.race([
        puppeteer.connect({
            browserWSEndpoint: wsEndpoint,
            defaultViewport: null
        }),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('WS connect timeout')), timeout)
        )
    ])
}

module.exports = {takeScreenshot, createScreenshotTaker}
