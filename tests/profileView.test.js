// Unit tests for the profile overview shared by the direct slash reply and
// the legacy button flow. Only database/db is mocked (getProfileStats);
// everything else is pure.

jest.mock('../src/database/db', () => ({
    getProfileStats: jest.fn(),
}))

const {getProfileStats} = require('../src/database/db')
const {buildProfileView} = require('../src/controller/commands/profileView')
const {languages} = require('../src/tools/language')

beforeEach(() => {
    jest.clearAllMocks()
    getProfileStats.mockResolvedValue({total: 42, lastMonth: 7, lastDay: 2})
})

describe('buildProfileView', () => {
    test('fetches stats for the given user and includes them in the text', async () => {
        const view = await buildProfileView({id: 'u1', language: 'en'})

        expect(getProfileStats).toHaveBeenCalledWith('u1')
        expect(view.content).toContain('42')
        expect(view.content).toContain('7')
        expect(view.content).toContain('2')
    })

    test('the language select preselects the user\'s current language', async () => {
        const view = await buildProfileView({id: 'u1', language: 'de'})

        const options = view.components[0].components[0].options.map(o => o.data)
        expect(options).toHaveLength(languages.length)
        const selected = options.find(o => o.default)
        expect(selected.value).toBe('de')
    })

    test('the reactions button label reflects the opt-out state', async () => {
        const onView = await buildProfileView({id: 'u1', language: 'en', reactions: true})
        const offView = await buildProfileView({id: 'u1', language: 'en', reactions: false})

        const label = view => view.components[1].components[0].data.label
        expect(label(onView)).not.toBe(label(offView))
    })

    test('includes a language select, a reactions toggle, and a DM button, in that order', async () => {
        const view = await buildProfileView({id: 'u1', language: 'en'})

        expect(view.components).toHaveLength(3)
        expect(view.components[0].components[0].data.custom_id).toBe('profile_language')
        expect(view.components[1].components[0].data.custom_id).toBe('profile_reactions')
        expect(view.components[2].components[0].data.custom_id).toBe('profile_dm')
    })
})
