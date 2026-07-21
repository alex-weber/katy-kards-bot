// ================= DISCORD JS ===================
const { Client, GatewayIntentBits, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder} = require('discord.js')
const {getUser, updateUser, getUsers} = require("../database/db")
const {translate} = require("../tools/translation/translator")
const {languages} = require("../tools/language")
const {discordHandler} = require("../controller/discordHandler")
const {redis} = require("../controller/redis")
const {cacheKeyPrefix} = require("../controller/messageCache")
const {getSynonymById, updateSynonym} = require("../database/synonym")
const {isManager} = require("../tools/search")
const {buildCommandList} = require("../controller/commands/synonymCommands")
const {invalidateSynonymCache} = require("../controller/synonymCache")
const {buildProfileView} = require("../controller/commands/profileView")
const {buildContactModal} = require("../tools/contactModal")
const {buildTermsView} = require("../controller/commands/termsCommands")
const {handleSlashCommand, handleSlashModal} = require("../controller/slashHandler")
const {attributeChannel} = require("../tools/attributedChannel")
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

async function onInteractionCreate(interaction)
{
    //slash (application) commands — the replacement for the legacy `!` prefix
    //commands, which depend on the Message Content Intent Discord is removing.
    if (interaction.isChatInputCommand()) {
        return await handleSlashCommand(interaction, client, redis)
    }

    //submitted /deck popups route through the slash handler
    if (interaction.isModalSubmit() &&
        await handleSlashModal(interaction, client, redis)) return

    if (!interaction.isButton() && !interaction.isModalSubmit() &&
        !interaction.isStringSelectMenu()) return

    const message = interaction.message
    const user = await getUser(interaction.user.id)

    //Terms of Service flow. Kept separate from the profile branch (which is
    //gated to active users) so that pending/declined users can accept.
    //The "Read Terms" button opens the explanation + Accept/Decline privately
    //(ephemeral), so nothing is spammed into the channel.
    if (interaction.customId === 'terms_show') {
        return await interaction.reply({
            ...buildTermsView(user.language, user),
            flags: MessageFlags.Ephemeral,
        })
    }

    if (interaction.customId === 'terms_accept' ||
        interaction.customId === 'terms_decline') {
        const accepted = interaction.customId === 'terms_accept'
        user.status = accepted ? 'active' : 'declined'
        await updateUser(user)
        await refreshCachedUser(interaction.user.id, '$.status', user.status)

        return await interaction.update({
            content: translate(user.language,
                accepted ? 'termsAccepted' : 'termsDeclined'),
            components: [],
        })
    }

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

        // Run the paginated command on behalf of the user who clicked, not the
        // bot that owns the button message. interaction.message.author is the
        // bot, so without this getGuildPart()/loadUser() key off the bot in DMs
        // and split the alt linked-list cache across two namespaces (the first
        // page under the user, the paged-in ones under the bot).
        message.author = interaction.user
        message.buttonId = interaction.customId
        // attribute the next page to whoever clicked, not the button's owner.
        // `channel` is a getter-only accessor on discord.js's Message class
        // (no setter), so a plain `message.channel = ...` silently no-ops in
        // this file's sloppy-mode CommonJS; defineProperty shadows it instead.
        Object.defineProperty(message, 'channel', {
            value: attributeChannel(message.channel, interaction.user, user.language),
            writable: true,
            configurable: true,
        })

        // remove the button
        await interaction.message.edit({ components: [] })


        const content = translate(user.language, 'fetching')

        await interaction.reply({
            content,
            flags: MessageFlags.Ephemeral
        })

        return await discordHandler(message, client, redis)
    }

    if (interaction.customId === 'contact_admins_button')
    {
        await interaction.showModal(buildContactModal(user.language))
        await interaction.message.delete().catch(() => {}) // ignore errors if already deleted
        return
    }

    if (interaction.customId === 'contact_admins_modal')
    {
        const messageText = interaction.fields.getTextInputValue('contactMessage')
        const { users } = await getUsers({ role: 'GOD', pageSize: 100 })
        
        if (users && users.length > 0) {
            let sent = false
            for (const admin of users) {
                try {
                    const adminUser = await client.users.fetch(admin.discordId)
                    if (adminUser) {
                        await adminUser.send(`**Contact from ${interaction.user.username}** (${interaction.user.id}):\n${messageText}`)
                        sent = true
                    }
                } catch (e) {
                    console.error('Failed to send contact DM to admin', admin.discordId, e)
                }
            }
            
            if (sent) {
                await interaction.reply({
                    content: translate(user.language, 'contactSuccess') || 'Your message has been sent to the bot administrators.',
                    flags: MessageFlags.Ephemeral
                })
            } else {
                await interaction.reply({
                    content: translate(user.language, 'contactFailDeliver') || 'Could not deliver the message. Please try opening an issue on GitHub.',
                    flags: MessageFlags.Ephemeral
                })
            }
        } else {
            await interaction.reply({
                content: translate(user.language, 'contactFailAdmins') || 'Could not find any administrators to contact.',
                flags: MessageFlags.Ephemeral
            })
        }
        return
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

        //public, so name the editor — otherwise this is a channel message
        //with no visible origin at all
        await interaction.reply(`${synonym.key} updated by ${interaction.user.username}`)
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
