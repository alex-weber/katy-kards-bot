// Unit tests for slash-command registration: the definitions themselves
// (buildCommands), the comparison used to skip needless re-registration
// (commandsSignature), and the register-or-skip decision (ensureGuildCommands).
// No DB/Redis dependency — deployCommands.js only touches discord.js.

const {
    buildCommands,
    commandsSignature,
    ensureGuildCommands,
    SIMPLE_COMMANDS,
} = require('../src/tools/deployCommands')

describe('buildCommands', () => {
    const commands = buildCommands()

    test('registers every top-level command exactly once', () => {
        const names = commands.map(c => c.name)
        expect(new Set(names).size).toBe(names.length)
        expect(names).toEqual(expect.arrayContaining([
            'search', 'commands', 'deck', 'help', 'td',
            ...SIMPLE_COMMANDS.map(entry => entry.name),
        ]))
    })

    test('/search requires the query option (no popup to fall back on)', () => {
        const search = commands.find(c => c.name === 'search')
        const query = search.options.find(o => o.name === 'query')
        expect(query.required).toBe(true)
    })

    test('/commands\' text filter is optional', () => {
        const commandsCmd = commands.find(c => c.name === 'commands')
        const text = commandsCmd.options.find(o => o.name === 'text')
        expect(text.required).toBe(false)
    })

    test('/td\'s unit option is optional and restricted to the real unit types', () => {
        const td = commands.find(c => c.name === 'td')
        const unit = td.options.find(o => o.name === 'unit')
        expect(unit.required).toBe(false)
        expect(unit.choices.map(c => c.value).sort()).toEqual(
            ['artillery', 'bomber', 'fighter', 'infantry', 'tank'])
    })

    test('/deck has no options (it opens a modal instead)', () => {
        const deck = commands.find(c => c.name === 'deck')
        expect(deck.options || []).toHaveLength(0)
    })
})

describe('commandsSignature', () => {
    test('is stable regardless of command order', () => {
        const a = [{name: 'b', description: 'B'}, {name: 'a', description: 'A'}]
        const b = [{name: 'a', description: 'A'}, {name: 'b', description: 'B'}]

        expect(commandsSignature(a)).toBe(commandsSignature(b))
    })

    test('changes when a description changes', () => {
        const a = [{name: 'a', description: 'old'}]
        const b = [{name: 'a', description: 'new'}]

        expect(commandsSignature(a)).not.toBe(commandsSignature(b))
    })

    test('changes when an option becomes required', () => {
        const a = [{name: 'a', description: 'A', options: [
            {type: 3, name: 'q', description: 'Q', required: false},
        ]}]
        const b = [{name: 'a', description: 'A', options: [
            {type: 3, name: 'q', description: 'Q', required: true},
        ]}]

        expect(commandsSignature(a)).not.toBe(commandsSignature(b))
    })

    test('matches buildCommands() against itself (real registration check)', () => {
        expect(commandsSignature(buildCommands())).toBe(commandsSignature(buildCommands()))
    })
})

describe('ensureGuildCommands', () => {
    function makeClient(existing) {
        return {
            application: {id: 'app-1'},
            rest: {
                get: jest.fn(async () => existing),
                put: jest.fn(async () => {}),
            },
        }
    }

    test('skips the PUT when Discord already has the desired commands', async () => {
        const desired = [{name: 'td', description: 'Top Deck'}]
        const client = makeClient(desired)

        const changed = await ensureGuildCommands(client, 'guild-1', desired)

        expect(changed).toBe(false)
        expect(client.rest.put).not.toHaveBeenCalled()
    })

    test('registers when the guild has a different command set', async () => {
        const client = makeClient([{name: 'old', description: 'stale'}])
        const desired = [{name: 'td', description: 'Top Deck'}]

        const changed = await ensureGuildCommands(client, 'guild-1', desired)

        expect(changed).toBe(true)
        expect(client.rest.put).toHaveBeenCalledTimes(1)
    })

    test('does nothing and reports failure when no application id is available', async () => {
        const client = {application: null, rest: {get: jest.fn(), put: jest.fn()}}
        delete process.env.DISCORD_CLIENT_ID

        const changed = await ensureGuildCommands(client, 'guild-1', [])

        expect(changed).toBe(false)
        expect(client.rest.get).not.toHaveBeenCalled()
    })

    test('registration failure is caught and reported as no change', async () => {
        const client = makeClient([{name: 'old', description: 'stale'}])
        client.rest.put = jest.fn(async () => { throw new Error('rate limited') })

        const changed = await ensureGuildCommands(
            client, 'guild-1', [{name: 'td', description: 'Top Deck'}])

        expect(changed).toBe(false)
    })
})
