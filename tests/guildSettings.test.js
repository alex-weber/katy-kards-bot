jest.mock('../src/controller/redis', () => ({
    redis: {
        json: {
            get: jest.fn(async () => null),
            set: jest.fn(async () => 'OK'),
        },
    },
    cachePrefix: 'web:test:',
}))

const {
    DEFAULT_GUILD_SETTINGS,
    getGuildSettings,
    saveGuildSettings,
    resolveGuildLimits,
} = require('../src/tools/guildSettings')
const {redis} = require('../src/controller/redis')

beforeEach(() => {
    redis.json.get.mockReset().mockResolvedValue(null)
    redis.json.set.mockReset().mockResolvedValue('OK')
})

describe('resolveGuildLimits', () => {
    test('returns defaults for a DM (no guild id)', async () => {
        expect(await resolveGuildLimits(undefined)).toEqual(DEFAULT_GUILD_SETTINGS)
    })

    test('returns defaults for a guild with no saved override', async () => {
        redis.json.get.mockResolvedValue([{}])
        expect(await resolveGuildLimits('123')).toEqual(DEFAULT_GUILD_SETTINGS)
    })

    test('returns the saved override for a configured guild', async () => {
        redis.json.get.mockResolvedValue([{
            '123': {channelAttachmentLimit: 3, botChannelAttachmentLimit: 7},
        }])
        expect(await resolveGuildLimits('123')).toEqual({
            channelAttachmentLimit: 3,
            botChannelAttachmentLimit: 7,
        })
    })

    test('accepts a numeric guild id', async () => {
        redis.json.get.mockResolvedValue([{
            '123': {channelAttachmentLimit: 4, botChannelAttachmentLimit: 8},
        }])
        expect(await resolveGuildLimits(123)).toEqual({
            channelAttachmentLimit: 4,
            botChannelAttachmentLimit: 8,
        })
    })
})

describe('getGuildSettings', () => {
    test('normalizes every saved entry', async () => {
        redis.json.get.mockResolvedValue([{
            '1': {channelAttachmentLimit: '6', botChannelAttachmentLimit: '9'},
        }])
        expect(await getGuildSettings()).toEqual({
            '1': {channelAttachmentLimit: 6, botChannelAttachmentLimit: 9},
        })
    })

    test('clamps values above the platform cap of 10', async () => {
        redis.json.get.mockResolvedValue([{
            '1': {channelAttachmentLimit: '25', botChannelAttachmentLimit: '11'},
        }])
        expect(await getGuildSettings()).toEqual({
            '1': {channelAttachmentLimit: 10, botChannelAttachmentLimit: 10},
        })
    })

    test('falls back to defaults for invalid or out-of-range values', async () => {
        redis.json.get.mockResolvedValue([{
            '1': {channelAttachmentLimit: 0, botChannelAttachmentLimit: 'x'},
        }])
        expect(await getGuildSettings()).toEqual({
            '1': DEFAULT_GUILD_SETTINGS,
        })
    })
})

describe('saveGuildSettings', () => {
    test('persists sanitized settings and returns them', async () => {
        const result = await saveGuildSettings({
            '9': {channelAttachmentLimit: '8', botChannelAttachmentLimit: '-1'},
        })
        expect(result).toEqual({
            '9': {
                channelAttachmentLimit: 8,
                botChannelAttachmentLimit: DEFAULT_GUILD_SETTINGS.botChannelAttachmentLimit,
            },
        })
        expect(redis.json.set).toHaveBeenCalledWith('web:test:guild-settings', '$', result)
    })
})
