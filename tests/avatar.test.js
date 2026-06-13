const { resolveAvatarUrl } = require('../src/tools/avatar')

describe('resolveAvatarUrl', () => {
    test('returns null without a client', async () => {
        expect(await resolveAvatarUrl(null, '111')).toBeNull()
    })

    test('returns null without a discord id', async () => {
        const client = { users: { fetch: jest.fn() } }
        expect(await resolveAvatarUrl(client, '')).toBeNull()
        expect(client.users.fetch).not.toHaveBeenCalled()
    })

    test('returns the displayAvatarURL for a known user', async () => {
        const client = {
            users: {
                fetch: jest.fn(async () => ({
                    displayAvatarURL: ({ extension, size }) =>
                        `https://cdn.discordapp.com/avatars/111/hash.${extension}?size=${size}`,
                })),
            },
        }
        const url = await resolveAvatarUrl(client, '111')
        expect(url).toBe('https://cdn.discordapp.com/avatars/111/hash.webp?size=128')
        expect(client.users.fetch).toHaveBeenCalledWith('111')
    })

    test('returns null when the user cannot be fetched (e.g. Telegram id)', async () => {
        const client = { users: { fetch: jest.fn(async () => { throw new Error('Unknown User') }) } }
        expect(await resolveAvatarUrl(client, '999')).toBeNull()
    })
})
