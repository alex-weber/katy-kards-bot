const { renderProfileText, reactionsLabel } = require('../src/tools/profile')

describe('renderProfileText', () => {
    test('includes both positions, both counts and the 24h count', () => {
        const text = renderProfileText('en', { total: 42, currentMonth: 9, allTimePosition: 3, currentMonthPosition: 7, lastDay: 2 })
        expect(text).toContain('42')
        expect(text).toContain('9')
        expect(text).toContain('#3')
        expect(text).toContain('#7')
        expect(text).toContain('2')
        expect(typeof text).toBe('string')
    })

    test('shows n/a when a position is not set', () => {
        const text = renderProfileText('en', { total: 0, currentMonth: 0, allTimePosition: null, currentMonthPosition: null, lastDay: 0 })
        expect(text).toContain('n/a')
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
