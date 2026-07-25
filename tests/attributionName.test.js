// The name the bot prints when it says who asked for something. People in a
// channel recognise each other by their nickname there, not by the unique
// @username, so this picks the most local name available.

const {attributionName} = require('../src/tools/attributionName')

const user = {username: 'katy_unique', displayName: 'Katy'}

describe('attributionName', () => {
    test('prefers the name the requester shows on this server', () => {
        expect(attributionName(user, {displayName: 'Kommissar Katy'})).toBe('Kommissar Katy')
    })

    // An uncached guild hands back the raw API member, which has `nick` and
    // none of GuildMember's accessors.
    test('reads a raw API member too', () => {
        expect(attributionName(user, {nick: 'Kommissar Katy'})).toBe('Kommissar Katy')
    })

    test('falls back to the account display name when there is no member', () => {
        expect(attributionName(user, null)).toBe('Katy')
    })

    // Escaped like everything else, which also fixes the old line: a username
    // may contain underscores, and "_Requested by katy_unique_" broke the
    // italics it was wrapped in.
    test('falls back to the unique username when there is nothing else', () => {
        expect(attributionName({username: 'katy_unique'}, null)).toBe('katy\\_unique')
        expect(attributionName({username: 'katy'}, null)).toBe('katy')
    })

    test('does not take an empty nickname for an answer', () => {
        expect(attributionName(user, {displayName: ''})).toBe('Katy')
    })

    // A username cannot hold markdown; a nickname can, and the attribution line
    // wraps the name in italics.
    test('escapes markdown so a nickname cannot break the line', () => {
        expect(attributionName(user, {displayName: '_Katy_'})).toBe('\\_Katy\\_')
        expect(attributionName(user, {displayName: '**bold**'})).toBe('\\*\\*bold\\*\\*')
    })

    test('still returns something when nothing is known at all', () => {
        expect(attributionName(null, null)).toBe('unknown')
    })
})
