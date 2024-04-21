const puppeteer = require('puppeteer')
const path = require("path")
/**
 *
 * @param url
 * @returns {Promise<void>}
 */
async function takeScreenshot(url) {

    const outputPath = __dirname+'/../tmp/deckScreenshot'
    const selector = '.Sidebar_side__scroll__xZp3s'
    const browser = await puppeteer.launch()
    const page = await browser.newPage()
    await page.setViewport({ width: 4000, height:2000 })
    console.time('pageLoading')
    await page.goto(url, { waitUntil: 'load' })
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

}

module.exports = takeScreenshot