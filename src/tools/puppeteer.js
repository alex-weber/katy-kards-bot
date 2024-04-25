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
        // Take a screenshot of the element
        let screenshot1 = await elementHandle.screenshot({
            path: outputPath+'.jpg',
            type: 'jpeg',
            quality: 100,
            clip: {
                x: 0,
                y: 0,
                width: boundingBox.width - rightMargin,
                height: 383,
            }
        })
        let screenshot2 = await elementHandle.screenshot({
            path: outputPath+'2.jpg',
            type: 'jpeg',
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

    // Listen for console events on the page
    function describe(jsHandle) {
        return jsHandle.evaluate(obj => {
            // serialize |obj| however you want
            return 'beautiful object of type ' + (typeof obj)
        }, jsHandle)
    }

    const options = { waitUntil: 'networkidle2' }
    const selector = '.Sidebar_side__scroll__xZp3s'
    let browser
    if (process.env.PATH_TO_CHROME)
    {
        browser = await puppeteer.launch({
            executablePath: process.env.PATH_TO_CHROME,
            args: ['--no-sandbox'],
            headless: true,
        })
        console.log('setting PATH_TO_CHROME to ', process.env.PATH_TO_CHROME)
    } else
    {
        console.log('starting DEFAULT PUPPETEER browser')
        browser = await puppeteer.launch({
            headless: true
        })
    }
    let page = await browser.newPage()
    page.on('console', async msg => {
        const args = await Promise.all(msg.args().map(arg => describe(arg)))
        console.log(msg.text(), ...args)
    })

    await page.setViewport({ width: 3000, height:2000 })
    console.time('pageLoading')
    const response = await page.goto(url, options)
    await waitFor(2000)
    if (!response.status || response.status() > 399) return false
    console.timeEnd('pageLoading')
    try {
        // Wait for the element to appear
        const selected = await page.waitForSelector(selector, { timeout: 5000 })
        await saveScreenshot(page, selector)

    } catch (error) {
        console.error('Error:', error)
        await browser.close()

        return false
    }

    await browser.close()

    return true

}

module.exports = {takeScreenshot, saveScreenshot}