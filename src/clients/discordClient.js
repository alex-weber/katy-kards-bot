// ================= DISCORD JS ===================
const { Client, GatewayIntentBits, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder} = require('discord.js')
const {getUser} = require("../database/db")
const {translate} = require("../tools/translation/translator")
const {discordHandler} = require("../controller/discordHandler")
const {redis} = require("../controller/redis")
const {getSynonymById, updateSynonym} = require("../database/synonym")
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
    ]})

async function onInteractionCreate(interaction)
{
    if (!interaction.isButton() && !interaction.isModalSubmit()) return

    const message = interaction.message

    if (interaction.customId.startsWith('next_button')) {

        message.buttonId = interaction.customId

        // remove the button
        await interaction.message.edit({ components: [] })

        const user = await getUser(interaction.user.id)
        const content = translate(user.language, 'fetching')

        await interaction.reply({
            content,
            flags: MessageFlags.Ephemeral
        })

        return await discordHandler(message, client, redis)
    }

    if (interaction.customId.startsWith('edit-synonym-'))
    {
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

        await interaction.reply(`${synonym.key} updated`)
        console.log(interaction.user.username, 'edited', synonym.key, '. New value: ' + newValue)

    }

    if (interaction.customId.startsWith('edit-syn-button-'))
    {
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
            .setTitle(`Edit Synonym: ${syn.key}`)

        const input = new TextInputBuilder()
            .setCustomId('synText')
            .setLabel('Message Text')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setValue(synText || '')

        const row = new ActionRowBuilder().addComponents(input)
        modal.addComponents(row)

        await interaction.showModal(modal)

    }
}

module.exports = {
    client,
    onInteractionCreate,
}