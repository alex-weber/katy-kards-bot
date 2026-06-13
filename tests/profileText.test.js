const { renderProfileText, reactionsLabel } = require('../src/tools/profile')

describe('renderProfileText', () => {
    test('includes all three stat values', () => {
        const text = renderProfileText('en', { total: 42, lastMonth: 7, lastDay: 2 })
        expect(text).toContain('42')
        expect(text).toContain('7')
        expect(text).toContain('2')
        expect(typeof text).toBe('string')
    })
})

describe('reactionsLabel', () => {
    test('returns distinct labels for on vs off', () => {
        const on = reactionsLabel('en', { reactions: true })
        const off = reactionsLabel('en', { reactions: false })
        expect(on).not.toBe(off)
    })

    test('treats undefined reactions as on (opt-out model)', () => {
        expect(reactionsLabel('en', {})).toBe(reactionsLabel('en', { reactions: true }))
    })
})
