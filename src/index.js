const express = require('express')
const app = express()
const port = parseInt(process.env.PORT) || 3000
const session = require('express-session')
const favicon = require('serve-favicon')
const compression = require('compression')
//handlers
const {discordHandler} = require('./controller/discordHandler')
const {telegramHandler} = require('./controller/telegramHandler')
//discord
const {client} = require('./clients/discordClient.js')
const {ActivityType, MessageFlags} = require('discord.js')
//telegram
const {telegramClient, telegramMessage} = require('./clients/telegram')


const {getServerList} = require("./tools/stats")
const {
    getUser,
    disconnect
} = require('./database/db')
const {translate} = require("./tools/translation/translator")

const RequestQueue = require("./tools/queue")
const requestQueue = new RequestQueue()

const {
    isAuthenticated,
    renderAuth,
    renderDashboard,
    renderMessages,
    renderServers,
    renderCommands,
    renderUptime,
    renderLanding,
    renderProfile,
    handleApi,
    handleLogout,
    handleLogin
} = require('./controller/router')

const {redis, redisStore, secure} = require('./controller/redis')
const cookieMaxAge = parseInt(process.env.COOKIE_MAX_AGE) || 30 * 24 * 60 * 60 * 1000

app.use('/static', express.static('src/js'))
app.use(favicon(__dirname + '/assets/favicon.ico'))
app.set('view engine', 'pug')
app.set('views', __dirname + '/views')
//cloud hosting
app.set('trust proxy', true)
app.use(compression())

//Redis Session
app.use(session({
    store: redisStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: secure,
        maxAge: cookieMaxAge,
    }
}))

//start listening for messages
app.listen(port, () => console.log(`Discord-Bot is listening at :${port}`))

// ROUTES
app.get('/', isAuthenticated, renderDashboard)
app.get('/', renderLanding)
app.get('/auth', renderAuth)
app.get('/login', handleLogin)
app.get('/logout', handleLogout)
app.get('/commands', isAuthenticated, renderCommands)
app.get('/messages', isAuthenticated, renderMessages)
app.get('/profile', isAuthenticated, renderProfile)
app.get('/servers', (req, res) => renderServers(req, res, servers))
app.get('/uptime', renderUptime)
app.get('/api/:method', handleApi)

let servers = []

//Discord-Bot login event
async function onClientReady()
{
    console.log(
        `Logged in as ${client.user.tag}`,
        'Server count: ' + client.guilds.cache.size
    )
    servers = getServerList(client)
    client.user.setActivity(
        client.guilds.cache.size + ' servers',
        { type: ActivityType.Watching }
    )
}

async function onMessageCreate(message)
{
    await discordHandler(message, client, redis)
}

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

// EVENT BINDINGS
client.on('ready', onClientReady)
client.on('messageCreate', onMessageCreate)
client.on('interactionCreate', onInteractionCreate)

//start Discord-Bot's session
client.login(process.env.DISCORD_TOKEN).then(() =>
{
    console.log('Discord client started')
})
//start Telegram-Bot's session if TOKEN is set
function onTelegramText(ctx) {
    requestQueue.enqueue(async function handleTelegramRequest() {
        await telegramHandler(ctx, redis)
    })
}

function onTelegramError(err) {
    console.error('telegramAPI error occurred:', err)

    if (err.on?.payload?.chat_id) {
        telegramClient.telegram
            .sendMessage(err.on.payload.chat_id, 'Error: file upload failed')
            .then()
    }
}

async function startTelegramClient() {
    telegramClient.on(telegramMessage('text'), onTelegramText)
    telegramClient.catch(onTelegramError)

    console.log('Telegram client started')
    await telegramClient.launch()
}

// START TELEGRAM (if available)
if (telegramClient) {
    startTelegramClient()
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
//shutdown
process.on('SIGINT', async () => {
    await exit('SIGINT', 130)
})
process.on('SIGTERM', async () => {
    await exit('SIGTERM', 143)
})

async function exit(event, code)
{
    //disconnect from DB
    await disconnect()
    //unblock deck screenshots service if currently running
    await redis.del('screenshot')
    console.log('exiting on', event)
    process.exit(code)
}