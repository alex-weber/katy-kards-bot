const puppeteer = require('puppeteer')
/**
 *
 * @param url
 * @returns {Promise<boolean>}
 */
async function takeScreenshot(url) {

    const outputPath = __dirname+'/../tmp/deckScreenshot'
    const selector = '.Sidebar_side__scroll__xZp3s'
    let browser = await puppeteer.launch()
    /* if (process.env.PATH_TO_CHROME)
    {
        browser = await puppeteer.launch({
            executablePath: process.env.PATH_TO_CHROME
        })
    }
    else */
    const page = await browser.newPage()
    await page.setViewport({ width: 4000, height:2000 })
    console.time('pageLoading')
    const response = await page.goto(url, { waitUntil: 'load' })
    if (response.status() > 400) return false
    console.timeEnd('pageLoading')
    try {
        // Wait for the element to appear
        const selected = await page.waitForSelector(selector, { timeout: 5000 })

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
    } catch (error) {
        console.error('Error:', error)
    }

    await browser.close()

    return true

}

module.exports = takeScreenshot