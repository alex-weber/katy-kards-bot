const express = require('express')
const app = express()
const port = parseInt(process.env.PORT) || 3000
const favicon = require('serve-favicon')
app.use(favicon(__dirname + '/assets/favicon.ico'))
app.set('view engine', 'pug')
app.set('views', __dirname + '/views')
//handlers
const {discordHandler} = require('./controller/discordHandler')
const {telegramHandler} = require('./controller/telegramHandler')
//discord
const {client} = require('./clients/discordClient.js')
//telegram
const {telegramClient, telegramMessage} = require('./clients/telegram')
const {getServerList, getUptimeStats} = require("./tools/stats")
//redis cache
const { createClient } = require('redis')
const redis = createClient({url: process.env.REDISCLOUD_URL})
redis.connect().then(()=>{ console.log('REDIS Client Connected') })
//start listening for messages
app.listen(port, () => console.log(`Discord-Bot is listening at :${port}`))
//http server
app.get('/', (req, res) =>
    res.render('index', {
        title: 'Katyusha Kards Bot',
        stats: {
            test: 'Welcome to Katyusha Kards Bot',
            test2: 'Here are some cards statistics',
        }
    }))
app.get('/uptime', async (req, res) => getUptimeStats(req, res))
const {getAllSynonyms} = require('./database/db')
app.get('/synonyms', async (req, res) => {
    const synonyms = await getAllSynonyms()
    res.render('synonyms', {
        title: 'Synonyms',
        synonyms: synonyms
    })
})
//Discord-Bot login event
client.on('ready', () =>
{
    console.log(`Logged in as ${client.user.tag}`, 'Server count: ' + client.guilds.cache.size)
    const guildNames = getServerList(client)
    app.get('/servers', (req, res) => res.render('servers', {
        title: 'Discord servers',
        servers: guildNames,
    }))
    //console.log(guildNames)
    client.user.setActivity(client.guilds.cache.size + ' servers', { type: 'WATCHING'})
})
//trigger on new messages
client.on('messageCreate', async message => discordHandler(message, client, redis))
//start Discord-Bot's session
client.login(process.env.DISCORD_TOKEN).then(() =>
{
    console.log('Discord client started')
})
//start Telegram-Bot's session if TOKEN is set
if (telegramClient)
{
    telegramClient.on(telegramMessage('text'), async ctx => telegramHandler(ctx))
    telegramClient.catch((err) => {
        console.error('telegramAPI error occurred:', err)
        if (err.on.payload.chat_id)
        {
            telegramClient.telegram.sendMessage(err.on.payload.chat_id,
                'Error: file upload failed').then(() => {
                console.error('Telegram cache error again')
            })
        }

    })
    telegramClient.launch().then(() =>
    {
        console.log('Telegram client started')
    })
}
//errors
client.on('error', error => {
    console.error(error)
})
redis.on('error', err => console.error('Redis Client Error', err))
//prevent the app from crashing
process.on('unhandledRejection', (reason, promise) =>
{
    console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})
process.on('uncaughtException', (err, origin) =>
{
    console.error('uncaught Exception:', err, origin)
})
process.on('uncaughtExceptionMonitor', (err, origin) =>
{
    console.error('uncaught Exception Monitor:', err, origin)
})
