const bot = require('../src/controller/bot')

describe('getLoggableCommand', () => {
    // A valid deck code per deckCodeRegEx: %%(\d{2,3}|\d{1}a)\|(\w*;){1,3}\w*
    const CODE = '%%210|aB3;cD4;eF5'

    test('extracts just the deck code from a longer message', () => {
        const raw = 'check out my deck ' + CODE + ' pretty cool'
        // ctx.command is the lowercased, prefix-stripped message
        const command = raw.toLowerCase()
        expect(bot.getLoggableCommand(command, raw)).toBe(CODE)
    })

    test('preserves the original case of the code', () => {
        const command = CODE.toLowerCase()
        expect(bot.getLoggableCommand(command, CODE)).toBe(CODE)
    })

    test('leaves a normal search command unchanged', () => {
        expect(bot.getLoggableCommand('leo', 'leo')).toBe('leo')
    })

    test('leaves a deck link unchanged', () => {
        const link = 'https://www.kards.com/decks/deck-builder?hash=abc'
        expect(bot.getLoggableCommand(link, link)).toBe(link)
    })
})
