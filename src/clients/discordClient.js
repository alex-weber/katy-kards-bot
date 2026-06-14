// ================= DISCORD JS ===================
const { Client, GatewayIntentBits, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder} = require('discord.js')
const {getUser, updateUser, getProfileStats} = require("../database/db")
const {translate} = require("../tools/translation/translator")
const {languages} = require("../tools/language")
const {discordHandler} = require("../controller/discordHandler")
const {redis} = require("../controller/redis")
const {cacheKeyPrefix} = require("../controller/messageCache")
const {getSynonymById, updateSynonym} = require("../database/synonym")
const {isManager} = require("../tools/search")
const {buildCommandList} = require("../controller/commands/synonymCommands")
const {invalidateSynonymCache} = require("../controller/synonymCache")
const {renderProfileText, reactionsLabel} = require("../tools/profile")
const {getButtonRow, ButtonStyle} = require("../tools/button")
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
    ]})

/**
 * Update a single field on the cached user record, if it is cached, so that
 * subsequent commands pick up the change without waiting for cache expiry.
 *
 * @param discordUserId
 * @param path JSONPath of the field (e.g. '$.language')
 * @param value
 * @returns {Promise<void>}
 */
async function refreshCachedUser(discordUserId, path, value)
{
    const userKey = cacheKeyPrefix + 'user:' + discordUserId
    if (await redis.exists(userKey)) {
        await redis.json.set(userKey, path, value)
    }
}

/**
 * Build the search-language select, with the user's current choice preselected.
 *
 * @param language the user's current search language
 * @returns {ActionRowBuilder}
 */
function getLanguageSelectRow(language)
{
    const menu = new StringSelectMenuBuilder()
        .setCustomId('profile_language')
        .setPlaceholder(translate(language, 'profileLanguage'))
        .addOptions(languages.map(lang => ({
            label: lang.toUpperCase(),
            value: lang,
            default: lang === language,
        })))

    return new ActionRowBuilder().addComponents(menu)
}

/**
 * Build the ephemeral profile overview (stats + language select + reactions
 * toggle) for a user.
 *
 * @param user
 * @returns {Promise<{content: string, components: *}>}
 */
async function buildProfileView(user)
{
    const stats = await getProfileStats(user.id)
    const content = renderProfileText(user.language, stats)
    const components = [
        getLanguageSelectRow(user.language),
        ...getButtonRow(
            reactionsLabel(user.language, user),
            'profile_reactions',
            ButtonStyle.Secondary),
        //Discord-only: DMs are blocked until the user opens a channel with the
        //bot. Telegram allows them by default, so no equivalent button there.
        ...getButtonRow(
            translate(user.language, 'dmButton'),
            'profile_dm',
            ButtonStyle.Primary),
    ]

    return {content, components}
}

async function onInteractionCreate(interaction)
{
    if (!interaction.isButton() && !interaction.isModalSubmit() &&
        !interaction.isStringSelectMenu()) return

    const message = interaction.message
    const user = await getUser(interaction.user.id)

    if (interaction.customId === 'profile_show' ||
        interaction.customId === 'profile_reactions' ||
        interaction.customId === 'profile_language' ||
        interaction.customId === 'profile_dm') {
        //this feature is not available for blocked users
        if (user.status !== 'active') {
            return await interaction.reply({
                content: translate(user.language, 'blocked'),
                flags: MessageFlags.Ephemeral,
            })
        }

        //open a DM channel with the user (active until the bot restarts)
        if (interaction.customId === 'profile_dm') {
            await interaction.user.createDM()

            return await interaction.reply({
                content: translate(user.language, 'dm'),
                flags: MessageFlags.Ephemeral,
            })
        }

        //flip the reactions opt-out flag and persist it
        if (interaction.customId === 'profile_reactions') {
            user.reactions = user.reactions === false
            await updateUser(user)
            await refreshCachedUser(interaction.user.id, '$.reactions', user.reactions)
            const view = await buildProfileView(user)

            return await interaction.update(view)
        }

        //change the search language and persist it
        if (interaction.customId === 'profile_language') {
            const language = interaction.values[0]
            if (languages.includes(language)) {
                user.language = language
                await updateUser(user)
                await refreshCachedUser(interaction.user.id, '$.language', language)
            }
            const view = await buildProfileView(user)

            return await interaction.update(view)
        }

        const view = await buildProfileView(user)

        return await interaction.reply({
            ...view,
            flags: MessageFlags.Ephemeral,
        })
    }

    if (interaction.customId.startsWith('next_button')) {

        message.buttonId = interaction.customId

        // remove the button
        await interaction.message.edit({ components: [] })


        const content = translate(user.language, 'fetching')

        await interaction.reply({
            content,
            flags: MessageFlags.Ephemeral
        })

        return await discordHandler(message, client, redis)
    }

    if (interaction.customId.startsWith('show_commands:'))
    {
        const command =
            interaction.customId.replace('show_commands:', '')
        const chunks = await buildCommandList(command)
        if (!chunks) {
            return await interaction.reply({
                content: 'No commands found',
                flags: MessageFlags.Ephemeral
            })
        }

        //first chunk is the reply, the rest are ephemeral follow-ups
        await interaction.reply({
            content: chunks[0],
            flags: MessageFlags.Ephemeral
        })
        for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp({
                content: chunks[i],
                flags: MessageFlags.Ephemeral
            })
        }

        return
    }

    if (interaction.customId.startsWith('edit-synonym-'))
    {
        if (!isManager(user))
        {
            return await interaction.reply({
                content: 'thanks for trying :)',
                flags: MessageFlags.Ephemeral
            })
        }
        const synId = interaction.customId.split('-')[2]
        if (!synId || isNaN(synId)) return

        const synonym = await getSynonymById(synId)
        let newValue = interaction.fields.getTextInputValue('synText')
        let value = JSON.stringify({ content: `text:${newValue}` })

        if (synonym.value.startsWith('{')) {
            const valueObject = JSON.parse(synonym.value)
            valueObject.content = 'text:' + newValue
            value = JSON.stringify(valueObject)
        }

        await updateSynonym(synonym.key, value)
        if (synonym.value !== value) await invalidateSynonymCache(synonym.key)

        await interaction.reply(`${synonym.key} updated`)
        console.log(interaction.user.username, 'edited', synonym.key, '. New value: ' + newValue)

    }

    if (interaction.customId.startsWith('edit-syn-button-'))
    {

        if (!isManager(user))
        {
            return await interaction.reply({
                content: 'Sure, Herr Einstein! :)',
                flags: MessageFlags.Ephemeral
            })
        }
        const synId = interaction.customId.split('-')[3]
        if (!synId || isNaN(synId)) return
        const syn = await getSynonymById(synId)

        let synText = ''

        if (syn.value) {
            try {
                const parsed = JSON.parse(syn.value)
                if (parsed.content) {
                    synText = parsed.content.replace(/^text:/, '')
                }
            } catch {
                // fallback: if value isn't valid JSON, treat as raw string
                synText = syn.value.replace(/^text:/, '')
            }
        }

        const modal = new ModalBuilder()
            .setCustomId(`edit-synonym-${syn.id}`)
            .setTitle(`Edit Custom Command: ${syn.key}`)

        const input = new TextInputBuilder()
            .setCustomId('synText')
            .setLabel('Message Text')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setValue(synText || '')

        const row = new ActionRowBuilder().addComponents(input)
        modal.addComponents(row)

        await interaction.showModal(modal)

        await interaction.message.delete().catch(() => {}) // ignore errors if already deleted

    }
}

module.exports = {
    client,
    onInteractionCreate,
}
