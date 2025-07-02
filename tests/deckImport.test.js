const {takeScreenshot} = require("../src/tools/puppeteer")

describe('Import deck', () => {
    test('create screenshots', async () => {

        const deckBuilderURL = 'https://www.kards.com/decks/deck-builder?hash='
        const code = '%%45|o0o5j4;bQbJbKnW7Kbs;7X9AiRbN;847Fo1'
        const hash = encodeURIComponent(code)

        const response = await takeScreenshot(deckBuilderURL+hash)
        expect(response).toBe(true)


    }, 25000)
})