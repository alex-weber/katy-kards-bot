// Unit tests for onInteractionCreate's dispatch: slash/modal routing to
// slashHandler, the button/select-menu component handlers, and — most
// importantly — the pagination attribution fix (Object.defineProperty
// shadowing Message's getter-only `channel`) and the edit-synonym-
// attribution fix, both landed this session.
//
// discordHandler and slashHandler are mocked to isolate dispatch. attributedChannel,
// profileView, contactModal, and termsCommands are kept real for integration
// confidence (their own unit tests cover the deeper logic).

jest.mock('../src/database/db', () => ({
    getUser: jest.fn(),
    updateUser: jest.fn(async () => {}),
    getUsers: jest.fn(async () => ({users: []})),
    createUserAudit: jest.fn(async () => {}),
    getProfileStats: jest.fn(async () => ({total: 3, currentMonth: 2, allTimePosition: 2, currentMonthPosition: 2, lastDay: 1})),
}))
jest.mock('../src/controller/redis', () => ({
    redis: {
        exists: jest.fn(async () => 0),
        json: {set: jest.fn(async () => {})},
    },
}))
jest.mock('../src/database/synonym', () => ({
    getSynonymById: jest.fn(),
    updateSynonym: jest.fn(async () => {}),
}))
jest.mock('../src/tools/search', () => ({
    isManager: jest.fn(() => false),
}))
jest.mock('../src/controller/commands/synonymCommands', () => ({
    buildCommandList: jest.fn(),
}))
jest.mock('../src/controller/synonymCache', () => ({
    invalidateSynonymCache: jest.fn(async () => {}),
}))
jest.mock('../src/controller/discordHandler', () => ({
    discordHandler: jest.fn(async () => {}),
}))
jest.mock('../src/controller/slashHandler', () => ({
    handleSlashCommand: jest.fn(async () => {}),
    handleSlashModal: jest.fn(async () => false),
}))

const {getUser, updateUser, getUsers} = require('../src/database/db')
const {redis} = require('../src/controller/redis')
const {getSynonymById, updateSynonym} = require('../src/database/synonym')
const {isManager} = require('../src/tools/search')
const {buildCommandList} = require('../src/controller/commands/synonymCommands')
const {invalidateSynonymCache} = require('../src/controller/synonymCache')
const {discordHandler} = require('../src/controller/discordHandler')
const {handleSlashCommand, handleSlashModal} = require('../src/controller/slashHandler')
const {client, onInteractionCreate} = require('../src/clients/discordClient')

function makeInteraction(overrides = {}) {
    const interaction = {
        isChatInputCommand: () => false,
        isModalSubmit: () => false,
        isButton: () => false,
        isStringSelectMenu: () => false,
        user: {id: 'u1', username: 'alice'},
        customId: undefined,
        message: {
            edit: jest.fn(async () => {}),
            delete: jest.fn(async () => {}),
        },
        fields: {getTextInputValue: jest.fn()},
        values: [],
        ...overrides,
    }
    interaction.reply = jest.fn(async () => {})
    interaction.update = jest.fn(async () => {})
    interaction.showModal = jest.fn(async () => {})

    return interaction
}

beforeEach(() => {
    jest.clearAllMocks()
    getUser.mockResolvedValue({id: 'u1', discordId: 'u1', language: 'en', status: 'active'})
    isManager.mockReturnValue(false)
})

describe('slash command / modal routing', () => {
    test('a chat input command is dispatched to handleSlashCommand', async () => {
        const interaction = makeInteraction({isChatInputCommand: () => true})

        await onInteractionCreate(interaction)

        expect(handleSlashCommand).toHaveBeenCalledWith(interaction, client, redis)
    })

    test('a handled modal submit (e.g. /deck) stops before the component logic', async () => {
        handleSlashModal.mockResolvedValueOnce(true)
        const interaction = makeInteraction({isModalSubmit: () => true})

        await onInteractionCreate(interaction)

        expect(handleSlashModal).toHaveBeenCalledWith(interaction, client, redis)
        expect(getUser).not.toHaveBeenCalled()
    })

    test('an unrecognized modal submit falls through to the component handlers', async () => {
        handleSlashModal.mockResolvedValueOnce(false)
        const interaction = makeInteraction({isModalSubmit: () => true, customId: 'terms_show'})

        await onInteractionCreate(interaction)

        expect(interaction.reply).toHaveBeenCalledTimes(1)
    })

    test('ignores interactions that are neither commands, buttons, modals, nor selects', async () => {
        const interaction = makeInteraction()

        await onInteractionCreate(interaction)

        expect(getUser).not.toHaveBeenCalled()
    })
})

describe('terms buttons', () => {
    test('terms_show replies privately with the explanation and buttons', async () => {
        const interaction = makeInteraction({isButton: () => true, customId: 'terms_show'})

        await onInteractionCreate(interaction)

        const arg = interaction.reply.mock.calls[0][0]
        expect(arg.flags).toBeDefined()
        const ids = arg.components[0].components.map(c => c.data.custom_id)
        expect(ids).toEqual(['terms_accept', 'terms_decline'])
    })

    test('terms_accept activates the user and updates the cache', async () => {
        getUser.mockResolvedValue({id: 'u1', discordId: 'u1', language: 'en', status: 'pending'})
        redis.exists.mockResolvedValueOnce(1)
        const interaction = makeInteraction({isButton: () => true, customId: 'terms_accept'})

        await onInteractionCreate(interaction)

        expect(updateUser).toHaveBeenCalledWith(
            expect.objectContaining({status: 'active'}))
        expect(redis.json.set).toHaveBeenCalledWith(
            expect.stringContaining('u1'), '$.status', 'active')
        expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
            components: [],
        }))
    })
})

describe('profile buttons', () => {
    test('rejects a blocked user before doing anything else', async () => {
        getUser.mockResolvedValue({id: 'u1', language: 'en', status: 'inactive'})
        const interaction = makeInteraction({isButton: () => true, customId: 'profile_show'})

        await onInteractionCreate(interaction)

        expect(interaction.reply).toHaveBeenCalledTimes(1)
        expect(updateUser).not.toHaveBeenCalled()
    })

    test('profile_dm opens a DM and confirms it', async () => {
        const createDM = jest.fn(async () => {})
        const interaction = makeInteraction({
            isButton: () => true, customId: 'profile_dm', user: {id: 'u1', createDM},
        })

        await onInteractionCreate(interaction)

        expect(createDM).toHaveBeenCalledTimes(1)
        expect(interaction.reply).toHaveBeenCalledTimes(1)
    })

    test('profile_reactions toggles the flag and re-renders the view', async () => {
        getUser.mockResolvedValue({id: 'u1', language: 'en', status: 'active', reactions: true})
        const interaction = makeInteraction({isButton: () => true, customId: 'profile_reactions'})

        await onInteractionCreate(interaction)

        expect(updateUser).toHaveBeenCalledWith(expect.objectContaining({reactions: false}))
        expect(interaction.update).toHaveBeenCalledTimes(1)
    })

    test('profile_language updates the language when it is a known one', async () => {
        const interaction = makeInteraction({
            isStringSelectMenu: () => true, customId: 'profile_language', values: ['de'],
        })

        await onInteractionCreate(interaction)

        expect(updateUser).toHaveBeenCalledWith(expect.objectContaining({language: 'de'}))
        expect(interaction.update).toHaveBeenCalledTimes(1)
    })

    test('profile_language ignores an unrecognized value but still re-renders', async () => {
        const interaction = makeInteraction({
            isStringSelectMenu: () => true, customId: 'profile_language', values: ['xx'],
        })

        await onInteractionCreate(interaction)

        expect(updateUser).not.toHaveBeenCalled()
        expect(interaction.update).toHaveBeenCalledTimes(1)
    })
})

describe('next_button pagination attribution', () => {
    // Regression test for the getter-only `Message.channel` bug: a plain
    // `message.channel = ...` silently no-ops in sloppy mode, so the fix uses
    // Object.defineProperty. This mirrors that exact shape (a class with a
    // getter and no setter) to prove the wrapping actually takes effect.
    class FakeMessage {
        #realChannel
        constructor(channel) { this.#realChannel = channel }
        get channel() { return this.#realChannel }
    }

    test('wraps message.channel so the next page is attributed to the clicker', async () => {
        const sent = []
        const realChannel = {send: jest.fn(async payload => { sent.push(payload) })}
        const message = new FakeMessage(realChannel)
        const interaction = makeInteraction({
            isButton: () => true,
            customId: 'next_button_soviet_infantry',
            user: {id: 'clicker', username: 'bob'},
            message: {edit: jest.fn(async () => {}), delete: jest.fn(async () => {})},
        })
        interaction.message = Object.assign(message, interaction.message)

        await onInteractionCreate(interaction)

        expect(discordHandler).toHaveBeenCalledTimes(1)
        const [passedMessage] = discordHandler.mock.calls[0]
        expect(passedMessage.author.id).toBe('clicker')

        // the defineProperty fix means message.channel is now the wrapped
        // proxy, not the original — sending through it must attribute bob
        await passedMessage.channel.send('page 2 results')
        expect(sent[0].content).toContain('bob')
        expect(realChannel.send).toHaveBeenCalledTimes(1)
    })
})

describe('contact admin modal', () => {
    test('DMs every GOD-role user and reports success', async () => {
        getUsers.mockResolvedValue({users: [{discordId: 'admin1'}, {discordId: 'admin2'}]})
        const dmSend = jest.fn(async () => {})
        client.users = {fetch: jest.fn(async () => ({send: dmSend}))}
        const interaction = makeInteraction({
            isModalSubmit: () => true, customId: 'contact_admins_modal',
            fields: {getTextInputValue: jest.fn(() => 'help me please')},
        })
        handleSlashModal.mockResolvedValueOnce(false)

        await onInteractionCreate(interaction)

        expect(dmSend).toHaveBeenCalledTimes(2)
        expect(dmSend.mock.calls[0][0]).toContain('alice')
        expect(dmSend.mock.calls[0][0]).toContain('help me please')
        expect(interaction.reply).toHaveBeenCalledTimes(1)
    })

    test('reports failure when no GOD-role users exist', async () => {
        getUsers.mockResolvedValue({users: []})
        const interaction = makeInteraction({
            isModalSubmit: () => true, customId: 'contact_admins_modal',
        })
        handleSlashModal.mockResolvedValueOnce(false)

        await onInteractionCreate(interaction)

        expect(interaction.reply.mock.calls[0][0].content).toMatch(/administrators/i)
    })

    test('reports delivery failure when every DM attempt throws', async () => {
        getUsers.mockResolvedValue({users: [{discordId: 'admin1'}]})
        client.users = {fetch: jest.fn(async () => { throw new Error('cannot DM') })}
        const interaction = makeInteraction({
            isModalSubmit: () => true, customId: 'contact_admins_modal',
        })
        handleSlashModal.mockResolvedValueOnce(false)

        await onInteractionCreate(interaction)

        expect(interaction.reply.mock.calls[0][0].content).toMatch(/deliver/i)
    })
})

describe('show_commands button', () => {
    test('replies "No commands found" when nothing matches', async () => {
        buildCommandList.mockResolvedValue(null)
        const interaction = makeInteraction({
            isButton: () => true, customId: 'show_commands:xyz',
        })

        await onInteractionCreate(interaction)

        expect(interaction.reply).toHaveBeenCalledWith({
            content: 'No commands found',
            flags: expect.anything(),
        })
    })
})

describe('edit-synonym- (custom command editing)', () => {
    test('rejects a non-manager without touching the database', async () => {
        isManager.mockReturnValue(false)
        const interaction = makeInteraction({
            isModalSubmit: () => true, customId: 'edit-synonym-42',
        })
        handleSlashModal.mockResolvedValueOnce(false)

        await onInteractionCreate(interaction)

        expect(updateSynonym).not.toHaveBeenCalled()
        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: 'thanks for trying :)',
        }))
    })

    // Regression test for the attribution fix: this reply is public (no
    // ephemeral flag) and previously had no visible origin at all.
    test('names the editor in the public reply', async () => {
        isManager.mockReturnValue(true)
        getSynonymById.mockResolvedValue({id: 42, key: 'greeting', value: 'text:hi'})
        const interaction = makeInteraction({
            isModalSubmit: () => true, customId: 'edit-synonym-42',
            fields: {getTextInputValue: jest.fn(() => 'hello there')},
        })
        handleSlashModal.mockResolvedValueOnce(false)

        await onInteractionCreate(interaction)

        expect(updateSynonym).toHaveBeenCalledWith(
            'greeting', JSON.stringify({content: 'text:hello there'}))
        expect(interaction.reply).toHaveBeenCalledWith('greeting updated by alice')
    })

    test('invalidates the synonym cache when the value actually changed', async () => {
        isManager.mockReturnValue(true)
        getSynonymById.mockResolvedValue({id: 42, key: 'greeting', value: 'text:old'})
        const interaction = makeInteraction({
            isModalSubmit: () => true, customId: 'edit-synonym-42',
            fields: {getTextInputValue: jest.fn(() => 'new text')},
        })
        handleSlashModal.mockResolvedValueOnce(false)

        await onInteractionCreate(interaction)

        expect(invalidateSynonymCache).toHaveBeenCalledWith('greeting')
    })
})

describe('edit-syn-button- (opens the edit modal)', () => {
    test('rejects a non-manager', async () => {
        isManager.mockReturnValue(false)
        const interaction = makeInteraction({
            isButton: () => true, customId: 'edit-syn-button-42',
        })

        await onInteractionCreate(interaction)

        expect(interaction.showModal).not.toHaveBeenCalled()
    })

    test('shows a prefilled modal and removes the original message for a manager', async () => {
        isManager.mockReturnValue(true)
        getSynonymById.mockResolvedValue({id: 42, key: 'greeting', value: 'text:hi there'})
        const interaction = makeInteraction({
            isButton: () => true, customId: 'edit-syn-button-42',
        })

        await onInteractionCreate(interaction)

        expect(interaction.showModal).toHaveBeenCalledTimes(1)
        const modal = interaction.showModal.mock.calls[0][0]
        expect(modal.data.custom_id).toBe('edit-synonym-42')
        expect(interaction.message.delete).toHaveBeenCalledTimes(1)
    })
})
