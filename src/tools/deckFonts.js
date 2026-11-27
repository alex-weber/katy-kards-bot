// The fonts the deck images are drawn with. They are registered once, at app
// start, so a missing or broken font file shows up in the startup log rather
// than as silently wrong text in the first deck image someone asks for.
const fs = require('fs')
const path = require('path')
const {GlobalFonts} = require('@napi-rs/canvas')

const FONT_DIR = path.join(__dirname, '..', 'assets', 'deck', 'fonts')

const DECK_FONTS = [
    {file: 'Oswald-Regular.ttf', family: 'Oswald'},
    {file: 'Oswald-SemiBold.ttf', family: 'Oswald'},
    {file: 'Oswald-Bold.ttf', family: 'Oswald'},
    {file: 'SpecialElite-Regular.ttf', family: 'Special Elite'},
    //kards.com sets its kredit numbers and copy counts in Gotham Narrow, which
    //it never serves, so browsers fall back to a plain bold sans; Open Sans
    //Bold is the free look-alike
    {file: 'OpenSans-Bold.ttf', family: 'Open Sans'},
    //none of the faces above has a single CJK glyph; the canvas falls back
    //glyph by glyph through the family list, so every font string names these
    //two last: Droid for Japanese and both Chinese scripts, NanumSquare for
    //Korean (Droid has no hangul at all, Nanum carries all 11,172 syllables)
    {file: 'DroidSansFallbackFull.ttf', family: 'Droid Sans Fallback'},
    {file: 'NanumSquareB.ttf', family: 'NanumSquare'},
]

let result = null

/**
 * Registers every deck font with the canvas. Safe to call more than once: the
 * fonts are registered on the first call and later calls return that outcome.
 * @param {object} [deps] overrides for tests
 * @returns {{ok: boolean, missing: string[]}} the font files that could not be
 *   registered
 */
function registerDeckFonts({fonts = DECK_FONTS, dir = FONT_DIR, globalFonts = GlobalFonts} = {}) {
    if (result && fonts === DECK_FONTS) return result

    const missing = []
    for (const {file, family} of fonts) {
        const fontPath = path.join(dir, file)
        if (!fs.existsSync(fontPath)) {
            missing.push(`${file} (not found)`)
            continue
        }
        if (!globalFonts.registerFromPath(fontPath, family) || !globalFonts.has(family)) {
            missing.push(`${file} (could not be loaded as ${family})`)
        }
    }

    const outcome = {ok: missing.length === 0, missing}
    if (fonts === DECK_FONTS) result = outcome

    return outcome
}

/**
 * Registers the deck fonts at app start and logs the outcome. A missing font
 * only degrades the deck images, so it is logged as an error rather than
 * stopping the bot.
 */
function ensureDeckFonts() {
    const {ok, missing} = registerDeckFonts()
    if (ok) console.log(`Deck fonts loaded (${DECK_FONTS.length})`)
    else console.error(`Deck fonts missing, deck images will render with fallback fonts: ${missing.join(', ')}`)

    return ok
}

module.exports = {registerDeckFonts, ensureDeckFonts, DECK_FONTS}
