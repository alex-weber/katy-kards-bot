// Unit tests for slash-command dispatch: which handler each command name
// routes to, the blocked/terms gating shared by /profile /contact /terms
// /deck, and routeThroughHandler's defer -> (delete | keep) decision.
//
// discordHandler and messageContext are mocked so this file tests dispatch
// and wiring only — the downstream command pipeline and the blocked-user
// predicate already have their own dedicated tests (messageContext.test.js).

jest.mock('../src/database/db', () => ({
    getUser: jest.fn(),
    updateUser: jest.fn(async () => {}),
    getProfileStats: jest.fn(async () => ({total: 3, currentMonth: 2, allTimePosition: 2, currentMonthPosition: 2, lastDay: 1})),
}))
jest.mock('../src/controller/discordHandler', () => ({
    discordHandler: jest.fn(async () => {}),
}))
jest.mock('../src/controller/messageContext', () => ({
    loadUser: jest.fn(),
    isUserBlocked: jest.fn(),
}))
jest.mock('../src/controller/commands/synonymCommands', () => ({
    buildCommandList: jest.fn(),
}))

const {MessageFlags} = require('discord.js')
const {handleSlashCommand, handleSlashModal} = require('../src/controller/slashHandler')
const {getUser} = require('../src/database/db')
const {discordHandler} = require('../src/controller/discordHandler')
const {loadUser, isUserBlocked} = require('../src/controller/messageContext')
const {buildCommandList} = require('../src/controller/commands/synonymCommands')

function makeInteraction({commandName, options = {}, customId} = {}) {
    const interaction = {
        commandName,
        customId,
        user: {id: 'u1', username: 'alice'},
        channel: {id: 'c1'},
        channelId: 'c1',
        guildId: 'g1',
        guild: {id: 'g1'},
        options: {getString: jest.fn(name => (name in options ? options[name] : null))},
        fields: {getTextInputValue: jest.fn(() => options.field)},
        deferred: false,
        replied: false,
    }
    interaction.deferReply = jest.fn(async () => { interaction.deferred = true })
    interaction.editReply = jest.fn(async () => {})
    interaction.deleteReply = jest.fn(async () => {})
    interaction.reply = jest.fn(async () => { interaction.replied = true })
    interaction.followUp = jest.fn(async () => {})
    interaction.showModal = jest.fn(async () => {})

    return interaction
}

const client = {}
const redis = {}

beforeEach(() => {
    jest.clearAllMocks()
    loadUser.mockResolvedValue({id: 'u1', language: 'en', status: 'active'})
    isUserBlocked.mockReturnValue(false)
    getUser.mockResolvedValue({id: 'u1', language: 'en'})
})

describe('/search', () => {
    test('defers ephemerally, builds prefix+query content, then deletes the ack', async () => {
        const interaction = makeInteraction({
            commandName: 'search', options: {query: 'soviet infantry'},
        })

        await handleSlashCommand(interaction, client, redis)

        expect(interaction.deferReply).toHaveBeenCalledWith({flags: MessageFlags.Ephemeral})
        expect(discordHandler).toHaveBeenCalledTimes(1)
        const [message] = discordHandler.mock.calls[0]
        expect(message.content).toBe('!soviet infantry')
        expect(message.isSlash).toBe(true)
        expect(interaction.deleteReply).toHaveBeenCalledTimes(1)
    })

    test('keeps the ephemeral ack when the handler replies privately (e.g. no results)', async () => {
        discordHandler.mockImplementationOnce(async message => {
            await message.replyPrivately('no cards found')
        })
        const interaction = makeInteraction({commandName: 'search', options: {query: 'xyz'}})

        await handleSlashCommand(interaction, client, redis)

        expect(interaction.editReply).toHaveBeenCalledWith('no cards found')
        expect(interaction.deleteReply).not.toHaveBeenCalled()
    })
})

describe('/deck', () => {
    test('shows the deck modal for an active user', async () => {
        const interaction = makeInteraction({commandName: 'deck'})

        await handleSlashCommand(interaction, client, redis)

        expect(interaction.showModal).toHaveBeenCalledTimes(1)
        expect(interaction.reply).not.toHaveBeenCalled()
    })

    test('gates a blocked user before showing the modal', async () => {
        isUserBlocked.mockReturnValue(true)
        const interaction = makeInteraction({commandName: 'deck'})

        await handleSlashCommand(interaction, client, redis)

        expect(interaction.showModal).not.toHaveBeenCalled()
        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
            flags: MessageFlags.Ephemeral,
        }))
    })

    test('gates a terms-pending user before showing the modal', async () => {
        loadUser.mockResolvedValue({id: 'u1', language: 'en', status: 'pending'})
        const interaction = makeInteraction({commandName: 'deck'})

        await handleSlashCommand(interaction, client, redis)

        expect(interaction.showModal).not.toHaveBeenCalled()
        expect(interaction.reply).toHaveBeenCalledTimes(1)
    })
})

describe('/help', () => {
    test('replies with the help text privately', async () => {
        const interaction = makeInteraction({commandName: 'help'})

        await handleSlashCommand(interaction, client, redis)

        expect(getUser).toHaveBeenCalledWith('u1')
        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
            flags: MessageFlags.Ephemeral,
        }))
        expect(interaction.reply.mock.calls[0][0].content).toContain('```')
    })
})

describe('/commands', () => {
    test('replies "No commands found" when nothing matches', async () => {
        buildCommandList.mockResolvedValue(null)
        const interaction = makeInteraction({commandName: 'commands'})

        await handleSlashCommand(interaction, client, redis)

        expect(interaction.reply).toHaveBeenCalledWith({
            content: 'No commands found',
            flags: MessageFlags.Ephemeral,
        })
    })

    test('replies with the first chunk and follows up with the rest', async () => {
        buildCommandList.mockResolvedValue(['chunk1', 'chunk2', 'chunk3'])
        const interaction = makeInteraction({commandName: 'commands', options: {text: 'a'}})

        await handleSlashCommand(interaction, client, redis)

        expect(buildCommandList).toHaveBeenCalledWith('commands a')
        expect(interaction.reply).toHaveBeenCalledWith({
            content: 'chunk1', flags: MessageFlags.Ephemeral,
        })
        expect(interaction.followUp).toHaveBeenCalledTimes(2)
    })
})

describe('/profile', () => {
    test('replies with the profile view for an active user', async () => {
        const interaction = makeInteraction({commandName: 'profile'})

        await handleSlashCommand(interaction, client, redis)

        expect(interaction.reply).toHaveBeenCalledTimes(1)
        const arg = interaction.reply.mock.calls[0][0]
        expect(arg.flags).toBe(MessageFlags.Ephemeral)
        expect(arg.embeds).toHaveLength(1)
    })

    test('shows the blocked message including the moderator note', async () => {
        isUserBlocked.mockReturnValue(true)
        loadUser.mockResolvedValue({
            id: 'u1', language: 'en', status: 'inactive', mode: 'appeal in #support',
        })
        const interaction = makeInteraction({commandName: 'profile'})

        await handleSlashCommand(interaction, client, redis)

        const arg = interaction.reply.mock.calls[0][0]
        expect(arg.content).toContain('appeal in #support')
    })

    test('shows the terms view for a pending user', async () => {
        loadUser.mockResolvedValue({id: 'u1', language: 'en', status: 'pending'})
        const interaction = makeInteraction({commandName: 'profile'})

        await handleSlashCommand(interaction, client, redis)

        const ids = interaction.reply.mock.calls[0][0].components[0].components
            .map(c => c.data.custom_id)
        expect(ids).toEqual(['terms_accept', 'terms_decline'])
    })
})

describe('/contact', () => {
    test('shows the contact modal for an active user', async () => {
        const interaction = makeInteraction({commandName: 'contact'})

        await handleSlashCommand(interaction, client, redis)

        expect(interaction.showModal).toHaveBeenCalledTimes(1)
        const modal = interaction.showModal.mock.calls[0][0]
        expect(modal.data.custom_id).toBe('contact_admins_modal')
    })

    test('gates a blocked user, no modal', async () => {
        isUserBlocked.mockReturnValue(true)
        const interaction = makeInteraction({commandName: 'contact'})

        await handleSlashCommand(interaction, client, redis)

        expect(interaction.showModal).not.toHaveBeenCalled()
        expect(interaction.reply).toHaveBeenCalledTimes(1)
    })
})

describe('/terms', () => {
    test('replies with the terms view for an active user', async () => {
        const interaction = makeInteraction({commandName: 'terms'})

        await handleSlashCommand(interaction, client, redis)

        const ids = interaction.reply.mock.calls[0][0].components[0].components
            .map(c => c.data.custom_id)
        expect(ids).toEqual(['terms_accept', 'terms_decline'])
    })

    test('gates a blocked user', async () => {
        isUserBlocked.mockReturnValue(true)
        const interaction = makeInteraction({commandName: 'terms'})

        await handleSlashCommand(interaction, client, redis)

        expect(interaction.reply.mock.calls[0][0].content).toContain('not available')
    })
})

describe('/td', () => {
    test('routes a bare /td with query "td"', async () => {
        const interaction = makeInteraction({commandName: 'td'})

        await handleSlashCommand(interaction, client, redis)

        expect(discordHandler.mock.calls[0][0].content).toBe('!td')
    })

    test('routes /td with a unit choice appended', async () => {
        const interaction = makeInteraction({commandName: 'td', options: {unit: 'infantry'}})

        await handleSlashCommand(interaction, client, redis)

        expect(discordHandler.mock.calls[0][0].content).toBe('!td infantry')
    })
})

describe('plain forwarded commands', () => {
    test('/alt routes through discordHandler with the mapped legacy text', async () => {
        const interaction = makeInteraction({commandName: 'alt'})

        await handleSlashCommand(interaction, client, redis)

        expect(discordHandler.mock.calls[0][0].content).toBe('!alt')
    })

    test('an unmapped command name does nothing (no reply, no crash)', async () => {
        const interaction = makeInteraction({commandName: 'not_a_real_command'})

        await expect(handleSlashCommand(interaction, client, redis)).resolves.not.toThrow()
        expect(interaction.reply).not.toHaveBeenCalled()
        expect(interaction.deferReply).not.toHaveBeenCalled()
    })
})

describe('error handling', () => {
    test('reports failure via editReply once the ack is already deferred', async () => {
        discordHandler.mockRejectedValueOnce(new Error('boom'))
        const interaction = makeInteraction({commandName: 'search', options: {query: 'x'}})

        await handleSlashCommand(interaction, client, redis)

        expect(interaction.editReply).toHaveBeenCalledWith({
            content: 'Oops... Something went wrong...',
        })
    })

    test('reports failure via a fresh reply when nothing was sent yet', async () => {
        loadUser.mockRejectedValueOnce(new Error('boom'))
        const interaction = makeInteraction({commandName: 'profile'})

        await handleSlashCommand(interaction, client, redis)

        expect(interaction.reply).toHaveBeenCalledWith({
            content: 'Oops... Something went wrong...',
            flags: MessageFlags.Ephemeral,
        })
    })
})

describe('handleSlashModal', () => {
    test('ignores a customId it does not own', async () => {
        const interaction = makeInteraction({customId: 'not-ours'})

        const handled = await handleSlashModal(interaction, client, redis)

        expect(handled).toBe(false)
        expect(discordHandler).not.toHaveBeenCalled()
    })

    test('routes a submitted deck modal through discordHandler', async () => {
        const interaction = makeInteraction({
            customId: 'slash_deck_modal', options: {field: 'AAECAX...'},
        })

        const handled = await handleSlashModal(interaction, client, redis)

        expect(handled).toBe(true)
        expect(discordHandler.mock.calls[0][0].content).toBe('!AAECAX...')
    })

    test('reports failure instead of throwing when the pipeline errors', async () => {
        discordHandler.mockRejectedValueOnce(new Error('boom'))
        const interaction = makeInteraction({
            customId: 'slash_deck_modal', options: {field: 'code'},
        })

        await expect(handleSlashModal(interaction, client, redis)).resolves.toBe(true)
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: 'Oops... Something went wrong...',
        })
    })
})
