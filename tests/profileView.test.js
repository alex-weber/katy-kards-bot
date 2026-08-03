// Unit tests for the profile overview shared by the direct slash reply and
// the legacy button flow. Only database/db is mocked (getProfileStats);
// everything else is pure.

jest.mock('../src/database/db', () => ({
    getProfileStats: jest.fn(),
}))

const {getProfileStats} = require('../src/database/db')
const {buildProfileView, profileIdentity} = require('../src/controller/commands/profileView')
const {languages} = require('../src/tools/language')

beforeEach(() => {
    jest.clearAllMocks()
    getProfileStats.mockResolvedValue({total: 42, currentMonth: 9, allTimePosition: 3, currentMonthPosition: 7, lastDay: 2})
})

describe('profileIdentity', () => {
    test('prefers the guild nickname and server avatar', () => {
        const id = profileIdentity({
            member: {displayName: 'Nick', displayAvatarURL: () => 'server.webp'},
            user: {displayName: 'Global', username: 'handle', displayAvatarURL: () => 'global.webp'},
        })
        expect(id.displayName).toBe('Nick')
        expect(id.avatarUrl).toBe('server.webp')
    })

    test('falls back to the user in a DM (no member)', () => {
        const id = profileIdentity({user: {username: 'handle', displayAvatarURL: () => 'global.webp'}})
        expect(id.displayName).toBe('handle')
        expect(id.avatarUrl).toBe('global.webp')
    })

    test('degrades to a default name and no avatar when nothing is available', () => {
        const id = profileIdentity({user: {}})
        expect(id.displayName).toBe('Profile')
        expect(id.avatarUrl).toBeNull()
    })
})

describe('buildProfileView', () => {
    test('puts both sections in one embed as single lines, with the avatar + name', async () => {
        const view = await buildProfileView(
            {id: 'u1', language: 'en'},
            {displayName: 'Katy', avatarUrl: 'http://x/a.webp'})

        expect(getProfileStats).toHaveBeenCalledWith('u1')
        // One embed keeps both sections the same width; no stray content/footer.
        expect(view.embeds).toHaveLength(1)
        expect(view.content).toBeUndefined()

        const embed = view.embeds[0].data
        // Name is an H1 in the description (not the small author line); avatar
        // stays as the large thumbnail.
        expect(embed.author).toBeUndefined()
        expect(embed.thumbnail.url).toBe('http://x/a.webp')
        expect(embed.footer).toBeUndefined()
        expect(embed.description).toMatch(/# Katy/)

        // Section titles are H2 headers; stat lines are normal (H3 == H2 in
        // Discord, so it is not used).
        expect(embed.description).toMatch(/## .*All-Time/)
        expect(embed.description).toMatch(/## .*This Month/)
        expect(embed.description).not.toContain('### ')
        expect(embed.description).toContain('**#3**')  // all-time rank
        expect(embed.description).toContain('**42**')  // all-time commands
        expect(embed.description).toContain('**#7**')  // this-month rank
        expect(embed.description).toContain('**9**')   // this-month commands
        expect(embed.description).toContain('**2**')   // last 24 hours

        expect(embed.description).not.toContain('Your stats')
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

    test('includes a language select, a reactions toggle, a DM button and a share button, in that order', async () => {
        const view = await buildProfileView({id: 'u1', language: 'en'})

        expect(view.components).toHaveLength(4)
        expect(view.components[0].components[0].data.custom_id).toBe('profile_language')
        expect(view.components[1].components[0].data.custom_id).toBe('profile_reactions')
        expect(view.components[2].components[0].data.custom_id).toBe('profile_dm')
        expect(view.components[3].components[0].data.custom_id).toBe('profile_share')
    })
})
