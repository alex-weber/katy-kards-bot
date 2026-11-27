const path = require('path')
const {registerDeckFonts, ensureDeckFonts, DECK_FONTS} = require('../src/tools/deckFonts')

const fontDir = path.join(__dirname, '..', 'src', 'assets', 'deck', 'fonts')

describe('deck fonts', () => {
    test('every bundled deck font registers', () => {
        expect(registerDeckFonts()).toEqual({ok: true, missing: []})
    })

    test('names every family the deck images ask for', () => {
        const families = new Set(DECK_FONTS.map(f => f.family))
        for (const family of ['Oswald', 'Open Sans', 'Special Elite', 'Droid Sans Fallback', 'NanumSquare']) {
            expect(families.has(family)).toBe(true)
        }
    })

    test('reports a font file that is not there', () => {
        const globalFonts = {registerFromPath: jest.fn(), has: jest.fn()}
        const outcome = registerDeckFonts({
            fonts: [{file: 'Nope.ttf', family: 'Nope'}],
            dir: fontDir,
            globalFonts,
        })

        expect(outcome).toEqual({ok: false, missing: ['Nope.ttf (not found)']})
        expect(globalFonts.registerFromPath).not.toHaveBeenCalled()
    })

    test('reports a font file the canvas cannot load', () => {
        const globalFonts = {registerFromPath: jest.fn(() => null), has: jest.fn(() => false)}
        const outcome = registerDeckFonts({
            fonts: [{file: 'Oswald-Bold.ttf', family: 'Broken'}],
            dir: fontDir,
            globalFonts,
        })

        expect(outcome).toEqual({ok: false, missing: ['Oswald-Bold.ttf (could not be loaded as Broken)']})
    })

    test('logs the outcome at app start', () => {
        const log = jest.spyOn(console, 'log').mockImplementation(() => {})
        expect(ensureDeckFonts()).toBe(true)
        expect(log).toHaveBeenCalledWith(`Deck fonts loaded (${DECK_FONTS.length})`)
        log.mockRestore()
    })
})
