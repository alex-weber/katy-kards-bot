// Defines the bot's slash (application) commands and registers them with
// Discord. Registration is automatic: on startup the bot ensures the commands
// for every guild it is in, and registers commands for any guild it later
// joins (see registerAllGuildCommands / registerGuildCommands, called from
// index.js). The already-registered commands are checked first, so restarts
// skip needless re-registration.
//
// Slash commands exist because Discord is removing the Message Content Intent,
// which the legacy `!` prefix commands depend on.
const {Routes, SlashCommandBuilder} = require('discord.js')

// Plain top-level commands (no options). Most simply forward to the existing
// text-command handlers via the slash adapter — `command` is the legacy
// command text the handler expects. profile/contact/terms are dispatched
// directly by dedicated cases in slashHandler.js instead (they reply on the
// interaction itself rather than via the text-command pipeline), so they
// carry no `command` mapping here — only name/description, for registration.
// These used to live under a `/system` group but are now top-level, so they
// match the bare commands users are already used to (e.g. `/utc`, not
// `/system utc`).
const SIMPLE_COMMANDS = [
    {name: 'alt', command: 'alt', description: 'Show the alternate-art card gallery'},
    {name: 'profile', description: 'Your bot stats and settings'},
    {name: 'online', command: 'online', description: 'Steam players online and in-game stats'},
    {name: 'utc', command: 'utc', description: 'Current UTC time'},
    {name: 'midnight', command: 'midnight', description: 'Relative time to 00:00 UTC+0 (daily reset)'},
    {name: 'ranking', command: 'ranking', description: 'Top Deck ranking'},
    {name: 'myrank', command: 'myrank', description: 'Your personal Top Deck ranking'},
    {name: 'contact', description: 'Contact the bot administrators'},
    {name: 'terms', description: 'Review the Terms of Service & Privacy Policy'},
]

/**
 * Build the slash command definitions (as JSON) sent to Discord.
 *
 * @returns {object[]}
 */
function buildCommands()
{
    // A required option so the query is typed directly after `/search` and
    // submitted with the rest of the command — no popup to click into first.
    const search = new SlashCommandBuilder()
        .setName('search')
        .setDescription('Search for KARDS cards')
        .addStringOption(option => option
            .setName('query')
            .setDescription('e.g. soviet infantry guard 1/8 3k 1c')
            .setRequired(true))

    // `text` mirrors the legacy `!commands a` argument (filter by prefix). Kept
    // optional so a bare `/commands` lists everything.
    const commands = new SlashCommandBuilder()
        .setName('commands')
        .setDescription('List the custom commands')
        .addStringOption(option => option
            .setName('text')
            .setDescription('Only show commands starting with this text (e.g. a)')
            .setRequired(false))

    // No option — invoking /deck opens a text-input popup for the link/code.
    const deck = new SlashCommandBuilder()
        .setName('deck')
        .setDescription('Render a deck from a kards.com link or an import code')

    const help = new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show how to use the bot')

    const simple = SIMPLE_COMMANDS.map(entry => new SlashCommandBuilder()
        .setName(entry.name)
        .setDescription(entry.description))

    return [search, commands, deck, help, ...simple]
        .map(command => command.toJSON())
}

/**
 * Reduce a command option to the fields that define its behaviour, so a
 * command already registered with Discord can be compared against the desired
 * definition without being tripped up by server-populated fields (id, version,
 * default permissions, …). Recurses into subcommand options.
 *
 * @param option
 * @returns {object}
 */
function normalizeOption(option)
{
    return {
        type: option.type,
        name: option.name,
        description: option.description,
        required: option.required || false,
        options: (option.options || []).map(normalizeOption),
    }
}

/**
 * Normalize a single command definition for comparison.
 *
 * @param command
 * @returns {object}
 */
function normalizeCommand(command)
{
    return {
        name: command.name,
        description: command.description,
        options: (command.options || []).map(normalizeOption),
    }
}

/**
 * A stable, order-independent signature of a command set, used to detect
 * whether the commands already registered in a guild match what we want.
 *
 * @param commands
 * @returns {string}
 */
function commandsSignature(commands)
{
    const normalized = commands
        .map(normalizeCommand)
        .sort((a, b) => a.name.localeCompare(b.name))

    return JSON.stringify(normalized)
}

/**
 * Resolve the application (client) id from a ready client, falling back to the
 * env var.
 *
 * @param client
 * @returns {string|undefined}
 */
function resolveClientId(client)
{
    return (client.application && client.application.id) ||
        process.env.DISCORD_CLIENT_ID
}

/**
 * Ensure one guild has exactly our slash commands. The currently registered
 * commands are fetched first and the write is skipped when they already match,
 * so restarts don't re-register (and hit rate limits) needlessly.
 *
 * @param client a logged-in client (uses its authenticated REST handler)
 * @param guildId
 * @param desired prebuilt command JSON (optional; built if omitted)
 * @param desiredSignature signature of `desired` (optional)
 * @returns {Promise<boolean>} true when a (re)registration was performed
 */
async function ensureGuildCommands(
    client, guildId,
    desired = buildCommands(),
    desiredSignature = commandsSignature(desired))
{
    const clientId = resolveClientId(client)
    if (!clientId) {
        console.error('cannot register slash commands: no application id')

        return false
    }

    const route = Routes.applicationGuildCommands(clientId, guildId)
    try {
        const existing = await client.rest.get(route)
        if (commandsSignature(existing) === desiredSignature) {
            return false //already up to date
        }

        await client.rest.put(route, {body: desired})
        console.log('registered slash commands for guild', guildId)

        return true
    } catch (error) {
        console.error(
            'failed to register slash commands for guild', guildId,
            error?.message)

        return false
    }
}

/**
 * Register (or refresh) slash commands for every guild the bot is currently in.
 * Called on startup; safe to run on every restart thanks to the up-to-date
 * check in ensureGuildCommands.
 *
 * @param client
 * @returns {Promise<void>}
 */
async function registerAllGuildCommands(client)
{
    const desired = buildCommands()
    const desiredSignature = commandsSignature(desired)
    const guildIds = [...client.guilds.cache.keys()]

    console.log(`ensuring slash commands across ${guildIds.length} guild(s)`)
    let changed = 0
    for (const guildId of guildIds) {
        if (await ensureGuildCommands(
            client, guildId, desired, desiredSignature)) changed++
    }
    console.log(
        `slash commands: ${changed} guild(s) updated,`,
        `${guildIds.length - changed} already current`)
}

/**
 * Register slash commands for a single guild — used when the bot joins a new
 * guild (guildCreate).
 *
 * @param client
 * @param guildId
 * @returns {Promise<boolean>}
 */
async function registerGuildCommands(client, guildId)
{
    return await ensureGuildCommands(client, guildId)
}

module.exports = {
    registerAllGuildCommands,
    registerGuildCommands,
    SIMPLE_COMMANDS,
}
