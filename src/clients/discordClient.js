// ================= DISCORD JS ===================
const { Client, GatewayIntentBits, MessageFlags} = require('discord.js')
const {getUser} = require("../database/db")
const {translate} = require("../tools/translation/translator")
const {discordHandler} = require("../controller/discordHandler")
const {redis} = require("../controller/redis")
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
    if (!interaction.isButton()) return

    if (interaction.customId.startsWith('next_button')) {
        const message = interaction.message
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
}

module.exports = {
    client,
    onInteractionCreate,
}