const puppeteer = require('puppeteer-core')
const browserLessKeys = getBrowserlessKeys()

/**
 *
 * @param page
 * @param selector
 * @returns {Promise<void>}
 */
async function saveScreenshot(page, selector) {

    const outputPath = __dirname+'/../tmp/deckScreenshot'
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
 *
 * @param url
 * @returns {Promise<boolean>}
 */
async function takeScreenshot(url) {


    if (!browserLessKeys.length) return false

    let blKey;
    if (browserLessKeys.length === 1) {
        blKey = browserLessKeys[0]
    } else {
        //get a random api key from the list
        const index = Math.floor(Math.random() * browserLessKeys.length)
        blKey = browserLessKeys[index]
        console.log('using Browserless key ' + index)
    }

    const options = { waitUntil: 'networkidle2' }
    const selector = '.Sidebar_side__scroll__xZp3s'

    const wsHost = process.env.BROWSERLESS_HOST || 'ws://production-ams.browserless.io'
    const timeout = parseInt(process.env.BROWSERLESS_TIMEOUT) || 10000

    const now = new Date().getTime()

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
        await saveScreenshot(page, selector)
        await browser.close()

        return true

    } catch (error) {
        console.error('Error:', error)

        return false
    }

}

function getBrowserlessKeys()
{
    const keys = []
    if (process.env.BROWSERLESS_API_KEY) keys.push(process.env.BROWSERLESS_API_KEY)
    for (let i = 2; i < 10; i++) {
        if (!process.env['BROWSERLESS_API_KEY_'+i]) break
        keys.push(process.env['BROWSERLESS_API_KEY_'+i])
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

module.exports = {takeScreenshot}