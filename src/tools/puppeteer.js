const puppeteer = require('puppeteer')

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
    const rightMargin = 60
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
                width: boundingBox.width - rightMargin,
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
                width: boundingBox.width - rightMargin,
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

    function waitFor(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds))
    }

    const options = { waitUntil: 'networkidle2' }
    const selector = '.Sidebar_side__scroll__xZp3s'
    const launchOptions =  {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--no-zygote',
        ],
        headless: true,
        devtools: false,
        ignoreDefaultArgs: ['--disable-extensions']
    }
    if (process.env.PATH_TO_CHROME)
    {
        launchOptions.executablePath = process.env.PATH_TO_CHROME
        console.log('setting PATH_TO_CHROME to ', process.env.PATH_TO_CHROME)
    }
    const browser = await puppeteer.launch(launchOptions)
    let page = await browser.newPage()
    await page.setViewport({ width: 3000, height:2000 })
    console.time('pageLoading')
    try {
        const response = await page.goto(url, options)
        if (!response.status || response.status() > 399)
        {
            await browser.close()
            return false
        }
    } catch (error) {
        await browser.close()
        return false
    }

    await waitFor(700)
    console.timeEnd('pageLoading')
    try {
        // Wait for the element to appear
        await page.waitForSelector(selector, { timeout: 5000 })
        await saveScreenshot(page, selector)
        await browser.close()

        return true

    } catch (error) {
        console.error('Error:', error)
        await browser.close()

        return false
    }

}

module.exports = {takeScreenshot}