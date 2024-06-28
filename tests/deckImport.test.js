const {takeScreenshot} = require("../src/tools/puppeteer")

describe('Import deck', () => {
    test('create screenshots', async () => {
        const url = 'https://www.kards.com/decks/13633-wc-deck-socialist-tokens'


        const deckBuilderURL = 'https://www.kards.com/decks/deck-builder?hash='
        const code = '%%45|o0o5j4;bQbJbKnW7Kbs;7X9AiRbN;847Fo1'
        const hash = encodeURIComponent(code)

        let response = await takeScreenshot(url)
        expect(response).toBe(true)

        response = await takeScreenshot(deckBuilderURL+hash)
        expect(response).toBe(true)


    }, 25000)
})