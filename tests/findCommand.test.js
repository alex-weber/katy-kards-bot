// Unit tests for the /find panel: the customId state round trip, the query it
// composes for /search, and the rendered components. No DB/Redis dependency.

const {
    buildFindView,
    buildTermModal,
    buildQuery,
    decodeState,
    encodeState,
    applyChange,
    sanitizeState,
    EMPTY_STATE,
    TERM_MAX_LENGTH,
    TERM_MIN_LENGTH,
} = require('../src/controller/commands/findCommand')

const full = {faction: 'germany', type: 'tank', kredits: '5', cost: '1', term: 'tiger'}

describe('state encoding', () => {
    test('round-trips through a customId', () => {
        expect(decodeState(encodeState('go', full))).toEqual({action: 'go', state: full})
    })

    test('keeps a separator inside the term', () => {
        const state = {...EMPTY_STATE, term: 'a:b'}
        expect(decodeState(encodeState('go', state)).state.term).toBe('a:b')
    })

    test('ignores ids that are not /find ids', () => {
        expect(decodeState('next_button_x')).toBeNull()
        expect(decodeState('find')).toBeNull()
        expect(decodeState(undefined)).toBeNull()
    })

    test('the longest possible id stays within Discord\'s 100-character limit', () => {
        const longest = {
            faction: 'finland', type: 'countermeasure', kredits: '12', cost: '6',
            term: 'x'.repeat(TERM_MAX_LENGTH),
        }
        for (const action of ['faction', 'kredits', 'modal', 'reset']) {
            expect(encodeState(action, longest).length).toBeLessThanOrEqual(100)
        }
    })
})

describe('sanitizeState', () => {
    test('drops values that are not offered in the dropdowns', () => {
        expect(sanitizeState({faction: 'mars', type: 'x', kredits: '11', cost: '99', term: ''}))
            .toEqual(EMPTY_STATE)
    })

    test('collapses whitespace, strips backticks and bounds the term', () => {
        expect(sanitizeState({...EMPTY_STATE, term: '  `big`   gun '}).term).toBe('big gun')
        expect(sanitizeState({...EMPTY_STATE, term: 'y'.repeat(80)}).term)
            .toHaveLength(TERM_MAX_LENGTH)
    })
})

describe('buildQuery', () => {
    test('composes the /search syntax', () => {
        expect(buildQuery(full)).toBe('germany tank 5k 1c tiger')
    })

    test('keeps zero costs', () => {
        expect(buildQuery({...EMPTY_STATE, kredits: '0', cost: '0'})).toBe('0k 0c')
    })

    test('is empty when nothing is selected', () => {
        expect(buildQuery(EMPTY_STATE)).toBe('')
    })
})

describe('applyChange', () => {
    test('sets and clears a dropdown', () => {
        const set = applyChange('faction', EMPTY_STATE, 'soviet')
        expect(set.faction).toBe('soviet')
        expect(applyChange('faction', set, '').faction).toBe('')
    })

    test('"Any" clears a dropdown', () => {
        expect(applyChange('type', full, 'any').type).toBe('')
    })

    test('an empty submitted term removes it', () => {
        expect(applyChange('modal', full, '').term).toBe('')
    })

    test('stores a submitted term', () => {
        expect(applyChange('modal', full, 'panther').term).toBe('panther')
    })

    test('reset empties everything', () => {
        expect(applyChange('reset', full)).toEqual(EMPTY_STATE)
    })
})

describe('buildFindView', () => {
    test('four dropdowns and a button row; Search disabled when empty', () => {
        const view = buildFindView('en')
        expect(view.components).toHaveLength(5)
        const buttons = view.components[4].toJSON().components
        expect(buttons.map(b => decodeState(b.custom_id).action)).toEqual(['term', 'reset', 'go'])
        expect(buttons[2].disabled).toBe(true)
        expect(view.content).not.toContain('`')
    })

    test('marks the current selections and previews the query', () => {
        const view = buildFindView('en', full)
        const faction = view.components[0].toJSON().components[0]
        expect(faction.min_values).toBe(0)
        expect(faction.options[0]).toMatchObject({value: 'any', label: 'Any', default: false})
        expect(faction.options.find(o => o.default).value).toBe('germany')
        expect(view.components[4].toJSON().components[2].disabled).toBe(false)
        expect(view.content).toContain('`germany tank 5k 1c tiger`')
    })

    test('uses the user\'s language', () => {
        expect(buildFindView('de').content).toContain('Karten finden')
    })
})

describe('buildTermModal', () => {
    test('carries the state and prefills the current term', () => {
        const modal = buildTermModal('en', full).toJSON()
        expect(decodeState(modal.custom_id)).toEqual({action: 'modal', state: full})
        const input = modal.components[0].components[0]
        expect(input.value).toBe('tiger')
        expect(input.required).toBe(false)
        expect(input.min_length).toBe(TERM_MIN_LENGTH)
    })
})
