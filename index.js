const express = require('express')
const app = express()
const port = parseInt(process.env.PORT) || 3000
//handlers
const {discordHandler} = require('./discordHandler')
const {telegramHandler} = require('./telegramHandler')
//telegram
const {telegramClient, telegramMessage, Input} = require('./telegram')
const {message} = require("telegraf/filters")
//start http server
app.get('/', (req, res) => res.send('Katyusha Kards Bot is online.'))
//start listening for messages
app.listen(port, () => console.log(`Discord-Bot is listening at :${port}`))
// ================= DISCORD JS ===================
const {Client, Intents, Permissions} = require('discord.js')
const client = new Client({
        intents: [
            Intents.FLAGS.GUILDS,
            Intents.FLAGS.GUILD_MESSAGES,
            Intents.FLAGS.GUILD_MEMBERS,
            Intents.FLAGS.DIRECT_MESSAGES,
        ]})
//Discord-Bot login event
client.on('ready', () =>
{
    console.log(`Logged in as ${client.user.tag}`, 'Server count: ' + client.guilds.cache.size)
    const guildNames = client.guilds.cache.map(g => g.name).join('\n')
    console.log(guildNames)
    client.user.setActivity(client.guilds.cache.size + ' servers', { type: 'WATCHING'})
})
//trigger on new messages
client.on('messageCreate', async message => discordHandler(message, client))
//start Discord-Bot's session
client.login(process.env.DISCORD_TOKEN).then(() =>
{
    console.log('Discord client started')
})
//
client.on('error', (error) => {
    console.log(error)
})

//start Telegram-Bot's session if TOKEN is set
if (telegramClient)
{
    telegramClient.on(telegramMessage('text'), async ctx => telegramHandler(ctx))
    telegramClient.catch((err) => {
        console.log('telegramAPI error occured:', err)
    })
    telegramClient.launch().then(() =>
    {
        console.log('Telegram client started')
    })
}
//prevent the app from crashing
process.on('unhandledRejection', (reason, promise) =>
{
    console.log('Unhandled Rejection at:', promise, 'reason:', reason)
})
process.on('uncaughtException', (err, origin) =>
{
    console.log('uncaught Exception:', err, origin)
})
process.on('uncaughtExceptionMonitor', (err, origin) =>
{
    console.log('uncaught Exception Monitor:', err, origin)
})
