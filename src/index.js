const express = require('express')
const app = express()
const port = parseInt(process.env.PORT) || 3000
const session = require('express-session')
const favicon = require('serve-favicon')
const compression = require('compression')

//messenger handlers
const {discordHandler} = require('./controller/discordHandler')
const {telegramHandler} = require("./controller/telegramHandler")

//discord client
const {client} = require('./clients/discordClient.js')
//stats
const {getServerList} = require("./tools/stats")
//for shutdown
const {disconnect} = require('./database/db')

const {
    isAuthenticated,
    renderAuth,
    renderDashboard,
    renderMessages,
    renderServers,
    renderCommands,
    renderLanding,
    renderProfile,
    renderCards,
    handleApi,
    handleLogout,
    handleLogin
} = require('./controller/router')

const {redis, redisStore, secure} = require('./controller/redis')
const cookieMaxAge = parseInt(process.env.COOKIE_MAX_AGE) || 30 * 24 * 60 * 60 * 1000

//frontend
app.use('/static', express.static('src/js'))
app.use(favicon(__dirname + '/assets/favicon.ico'))
app.set('view engine', 'pug')
app.set('views', __dirname + '/views')
app.use(compression())
//cloud hosting
app.set('trust proxy', true)

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

app.use((req, res, next) => {
    res.locals.currentPath = req.path || '/'
    next()
})


//start listening for messages
app.listen(port, () => console.log(`Katyusha-Bot is listening at :${port}`))

// WEB ROUTES
app.get('/', isAuthenticated, renderDashboard)
app.get('/', renderLanding)
app.get('/auth', renderAuth)
app.get('/login', handleLogin)
app.get('/logout', handleLogout)
app.get('/commands', isAuthenticated, renderCommands)
app.get('/messages', isAuthenticated, renderMessages)
app.get('/profile', isAuthenticated, renderProfile)
app.get('/servers', (req, res) => renderServers(req, res, servers))
app.get('/cards', renderCards)
app.get('/api/:method', handleApi)

let servers = [] //we get them when Discord client is ready

//Discord-Bot login event
async function onClientReady()
{
    console.log(
        `Logged in as ${client.user.tag}`,
        'Server count: ' + client.guilds.cache.size
    )
    servers = getServerList(client)
    client.user.setActivity(
        'Watching ' + client.guilds.cache.size + ' servers'
    )
}

async function onMessageCreate(message)
{
    await discordHandler(message, client, redis)
}

const {onInteractionCreate} = require('./clients/discordClient')
// DISCORD EVENT BINDINGS
client.on('clientReady', onClientReady)
client.on('messageCreate', onMessageCreate)
client.on('interactionCreate', onInteractionCreate)

//start Discord-Bot's session
client.login(process.env.DISCORD_TOKEN).then(() =>
{
    console.log('Discord client started')
})

const RequestQueue = require("./tools/queue")
const requestQueue = new RequestQueue()
const {
    telegramMessage,
    telegramClient,
    onTelegramError,
} = require("./clients/telegram")

async function startTelegramClient() {
    telegramClient.on(telegramMessage('text'), ctx => onTelegramText(ctx, redis))
    telegramClient.catch(onTelegramError)

    console.log('Telegram client started')
    await telegramClient.launch()
}

function onTelegramText(ctx, redis) {
    requestQueue.enqueue(async function handleTelegramRequest() {
        await telegramHandler(ctx, redis)
    })
}

//start Telegram-Bot's session if TOKEN is set
if (telegramClient) startTelegramClient()

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