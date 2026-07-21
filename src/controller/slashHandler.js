const {
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
} = require('discord.js')
const bot = require('./bot')
const {discordHandler} = require('./discordHandler')
const {getUser} = require('../database/db')
const {translate} = require('../tools/translation/translator')
const {buildCommandList} = require('./commands/synonymCommands')
const {SIMPLE_COMMANDS} = require('../tools/deployCommands')
const {buildProfileView} = require('./commands/profileView')
const {buildContactModal} = require('../tools/contactModal')
const {requiresTermsAcceptance, buildTermsView} = require('./commands/termsCommands')
const {attributeChannel} = require('../tools/attributedChannel')
const {loadUser, isUserBlocked} = require('./messageContext')

//map a plain command name -> the legacy command text it maps to
const simpleLookup = Object.fromEntries(
    SIMPLE_COMMANDS.map(entry => [entry.name, entry.command]))

/**
 * Present a slash interaction as a message-like object so it can flow through
 * the existing discordHandler pipeline (cache, pagination, permissions, terms
 * gate, role limits, DB logging). Results are posted to the channel exactly
 * like the legacy prefix commands; the interaction itself is acknowledged
 * separately by routeThroughHandler.
 *
 * The channel is wrapped so every message it posts is attributed to the
 * invoking user (and the command text they used) — unlike legacy `!`
 * commands, a slash command leaves no visible trace of who ran it (the
 * interaction ack is always ephemeral), so without this the reply would be an
 * anonymous public message.
 *
 * @param interaction
 * @param content the reconstructed command text (prefix + query)
 * @param language language for the attribution line
 * @param state shared with routeThroughHandler; flips `repliedPrivately` when
 *   a handler uses `replyPrivately`, so the caller knows not to delete it
 * @param query the command text without the prefix, shown in the attribution
 *   line so moderators can see not just who ran a command but what they typed
 * @returns {object}
 */
function buildInteractionMessage(interaction, content, language, state, query)
{
    return {
        content,
        author: interaction.user,
        channel: attributeChannel(interaction.channel, interaction.user, language, query),
        channelId: interaction.channelId,
        guildId: interaction.guildId,
        guild: interaction.guild,
        //no source message to react to for a slash command
        react: async () => {},
        //no attachments arrive via these slash commands
        attachments: new Map(),
        buttonId: undefined,
        //lets discordHandler skip the legacy-command deprecation notice
        isSlash: true,
        //escape hatch for replies that shouldn't spam a public channel (e.g.
        //"nothing found"): show `payload` privately to the invoking user by
        //editing the deferred ephemeral ack, instead of a public channel.send
        replyPrivately: async payload => {
            state.repliedPrivately = true
            await interaction.editReply(payload)
        },
    }
}

/**
 * Route a slash command through discordHandler. The card/text results are sent
 * to the channel by the handler, so the interaction only needs a private
 * acknowledgement, which is deleted once the work is done — unless a handler
 * used `replyPrivately`, in which case that ephemeral reply *is* the result
 * and must be left in place.
 *
 * @param interaction
 * @param client
 * @param redis
 * @param prefix
 * @param query the command text without the prefix (e.g. a search query)
 * @returns {Promise<void>}
 */
async function routeThroughHandler(interaction, client, redis, prefix, query)
{
    await interaction.deferReply({flags: MessageFlags.Ephemeral})
    //cache-aware: discordHandler's own pipeline loads this same user again
    //right after (via loadUser in messageContext.js) — using the same cached
    //path here means that second load is a cache hit instead of a second,
    //uncached DB round trip
    const user = await loadUser({author: interaction.user}, redis)
    const state = {repliedPrivately: false}
    const message = buildInteractionMessage(
        interaction, prefix + query, user.language, state, query)
    await discordHandler(message, client, redis)
    if (!state.repliedPrivately) await interaction.deleteReply().catch(() => {})
}

//maps a modal customId -> the text-input field id whose value becomes the
//command text handed to discordHandler
const MODAL_FIELDS = {
    slash_deck_modal: 'code',
}

/**
 * Build a single-field text modal.
 *
 * @param customId
 * @param title
 * @param inputId
 * @param label
 * @param style TextInputStyle
 * @param placeholder
 * @returns {ModalBuilder}
 */
function buildTextModal(customId, title, inputId, label, style, placeholder)
{
    const input = new TextInputBuilder()
        .setCustomId(inputId)
        .setLabel(label)
        .setStyle(style)
        .setRequired(true)
        .setPlaceholder(placeholder)

    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title)
        .addComponents(new ActionRowBuilder().addComponents(input))
}

/**
 * Open the deck popup for a kards.com link or an import code. Gated up front
 * like /profile, /contact, and /terms — otherwise a blocked/terms-pending
 * user could open and fill in the modal before being turned away only once
 * they submit it.
 *
 * @param interaction
 * @param redis
 * @returns {Promise<void>}
 */
async function showDeckModal(interaction, redis)
{
    const user = await loadGatedUser(interaction, redis)
    if (!user) return

    await interaction.showModal(buildTextModal(
        'slash_deck_modal', 'Deck screenshot', 'code', 'Deck link or import code',
        TextInputStyle.Paragraph, 'A kards.com deck link or an import code'))
}

/**
 * Handle a submitted /deck popup. Returns false when the modal is not one of
 * ours (so the caller can fall through to other modal handlers).
 *
 * @param interaction
 * @param client
 * @param redis
 * @returns {Promise<boolean>} true when handled
 */
async function handleSlashModal(interaction, client, redis)
{
    const field = MODAL_FIELDS[interaction.customId]
    if (!field) return false

    try {
        const prefix = bot.getPrefix(interaction)
        const value = interaction.fields.getTextInputValue(field)
        await routeThroughHandler(interaction, client, redis, prefix, value)
    } catch (error) {
        console.error('slash modal error:', interaction.customId, error)
        await respondError(interaction)
    }

    return true
}

/**
 * Reply with the help text, privately to the invoking user.
 *
 * @param interaction
 * @returns {Promise<void>}
 */
async function replyHelp(interaction)
{
    const user = await getUser(interaction.user.id)
    await interaction.reply({
        content: '```' + translate(user.language, 'help') + '```',
        flags: MessageFlags.Ephemeral,
    })
}

/**
 * Reply with the custom-command list, privately to the invoking user. Mirrors
 * the legacy "show_commands" button flow but skips the button and replies
 * directly. An optional argument filters by prefix (e.g. /commands a).
 *
 * @param interaction
 * @returns {Promise<void>}
 */
async function replyCommands(interaction)
{
    const text = interaction.options.getString('text') || ''
    const chunks = await buildCommandList(('commands ' + text).trim())
    if (!chunks) {
        return await interaction.reply({
            content: 'No commands found',
            flags: MessageFlags.Ephemeral,
        })
    }

    //first chunk is the reply, the rest are ephemeral follow-ups
    await interaction.reply({content: chunks[0], flags: MessageFlags.Ephemeral})
    for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({
            content: chunks[i],
            flags: MessageFlags.Ephemeral,
        })
    }
}

/**
 * Reply with the "blocked" message, privately, including the moderator's
 * custom `user.mode` note if one is set — mirroring what checkUserStatus
 * (messageContext.js) shows on the legacy `!` path, just privately instead of
 * in the channel (these commands never post publicly to begin with).
 *
 * @param interaction
 * @param user
 * @returns {Promise<void>}
 */
async function replyBlocked(interaction, user)
{
    const content = user.mode
        ? translate(user.language, 'blocked') + '\n\n' + user.mode
        : translate(user.language, 'blocked')
    await interaction.reply({content, flags: MessageFlags.Ephemeral})
}

/**
 * Load the invoking user and gate the interaction the same way discordHandler
 * gates every other command (checkUserStatus / handleTermsGate in
 * messageContext.js and termsCommands.js) — needed here because /profile,
 * /contact, /terms, and /deck reply directly on the interaction instead of
 * going through that pipeline.
 *
 * @param interaction
 * @param redis
 * @returns {Promise<object|null>} the loaded user, or null when the
 *   interaction was already replied to (blocked / terms-pending) and the
 *   caller should stop
 */
async function loadGatedUser(interaction, redis)
{
    const user = await loadUser({author: interaction.user}, redis)
    if (isUserBlocked(user)) {
        await replyBlocked(interaction, user)
        return null
    }
    if (requiresTermsAcceptance(user)) {
        await interaction.reply({
            ...buildTermsView(user.language, user),
            flags: MessageFlags.Ephemeral,
        })
        return null
    }

    return user
}

/**
 * Reply with the profile stats view directly, privately to the invoking user.
 * Slash commands are interactions in their own right, so unlike the legacy
 * `!profile` text command there is no need for an intermediate "show my
 * profile" button just to get an ephemeral reply.
 *
 * @param interaction
 * @param redis
 * @returns {Promise<void>}
 */
async function replyProfile(interaction, redis)
{
    const user = await loadGatedUser(interaction, redis)
    if (!user) return

    const view = await buildProfileView(user)
    await interaction.reply({...view, flags: MessageFlags.Ephemeral})
}

/**
 * Open the "contact admins" modal directly. A modal must be a Discord
 * interaction's first response, so this cannot go through the deferred
 * routeThroughHandler pipeline the way other commands do — unlike the legacy
 * flow, there is no intermediate "Contact Admins" button to show it from.
 *
 * @param interaction
 * @param redis
 * @returns {Promise<void>}
 */
async function showContactModal(interaction, redis)
{
    const user = await loadGatedUser(interaction, redis)
    if (!user) return

    await interaction.showModal(buildContactModal(user.language))
}

/**
 * Reply with the Terms of Service explanation and Accept/Decline buttons
 * directly, privately to the invoking user, skipping the legacy "Read Terms"
 * button.
 *
 * @param interaction
 * @param redis
 * @returns {Promise<void>}
 */
async function replyTerms(interaction, redis)
{
    const user = await loadGatedUser(interaction, redis)
    if (!user) return

    await interaction.reply({
        ...buildTermsView(user.language, user),
        flags: MessageFlags.Ephemeral,
    })
}

/**
 * Report a failure back to the user without crashing, whatever reply state the
 * interaction is in.
 *
 * @param interaction
 * @returns {Promise<void>}
 */
async function respondError(interaction)
{
    const content = 'Oops... Something went wrong...'
    try {
        if (interaction.deferred) return await interaction.editReply({content})
        if (interaction.replied) {
            return await interaction.followUp({content, flags: MessageFlags.Ephemeral})
        }
        await interaction.reply({content, flags: MessageFlags.Ephemeral})
    } catch (error) {
        console.error('failed to report slash command error:', error?.message)
    }
}

/**
 * Dispatch a chat-input (slash) command.
 *
 * @param interaction
 * @param client
 * @param redis
 * @returns {Promise<void>}
 */
async function handleSlashCommand(interaction, client, redis)
{
    const prefix = bot.getPrefix(interaction)
    try {
        switch (interaction.commandName) {
            case 'search':
                return await routeThroughHandler(interaction, client, redis,
                    prefix, interaction.options.getString('query'))
            case 'deck':
                return await showDeckModal(interaction, redis)
            case 'help':
                return await replyHelp(interaction)
            case 'commands':
                return await replyCommands(interaction)
            case 'profile':
                return await replyProfile(interaction, redis)
            case 'contact':
                return await showContactModal(interaction, redis)
            case 'terms':
                return await replyTerms(interaction, redis)
            default: {
                //plain commands (alt, utc, online, midnight, ranking, myrank, …)
                const command = simpleLookup[interaction.commandName]
                if (command) {
                    return await routeThroughHandler(interaction, client, redis,
                        prefix, command)
                }
            }
        }
    } catch (error) {
        console.error('slash command error:', interaction.commandName, error)
        await respondError(interaction)
    }
}

module.exports = {handleSlashCommand, handleSlashModal}
