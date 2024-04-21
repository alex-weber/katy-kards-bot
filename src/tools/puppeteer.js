const puppeteer = require('puppeteer')

/**
 *
 * @param url
 * @returns {Promise<void>}
 */
async function takeScreenshot(url) {

    const outputPath = '../tmp/deckScreenshot.jpg'
    const selector = '.Sidebar_side__scroll__xZp3s'
    const browser = await puppeteer.launch()
    const page = await browser.newPage()
    await page.setViewport({ width: 4000, height:2000 })
    await page.goto(url, { waitUntil: 'networkidle0' })
    
    try {
        // Wait for the element to appear
        await page.waitForSelector(selector, { timeout: 100 })

        // Get the bounding box of the element
        const elementHandle = await page.$(selector)
        const boundingBox = await elementHandle.boundingBox()

        if (boundingBox) {
            // Take a screenshot of the element
            await elementHandle.screenshot({
                path: outputPath,
                type: 'jpeg',
                quality: 90,
                clip: {
                    x: 0,
                    y: 0,
                    width: boundingBox.width - 60,
                    height: boundingBox.height
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

// Example usage:
const url = 'https://www.kards.com/en/decks/15222-aviazione-pesante-heavy-aviation'

takeScreenshot(url)
    .then(() => console.log('Screenshot captured successfully'))
    .catch(error => console.error('Error capturing screenshot:', error))
