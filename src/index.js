const express = require('express')
const app = express()
const port = parseInt(process.env.PORT) || 3000
const session = require('express-session')
const favicon = require('serve-favicon')
const compression = require('compression')
const lusca = require('lusca')
const rateLimit = require('express-rate-limit')

//messenger handlers
const {discordHandler} = require('./controller/discordHandler')
const {telegramHandler, telegramCallbackHandler} = require("./controller/telegramHandler")

//discord client
const {client} = require('./clients/discordClient.js')
//stats
const {getServerList} = require("./tools/stats")
//for shutdown
const {disconnect} = require('./database/db')

const {
    isAuthenticated,
    requireManager,
    requireGod,
    renderAuth,
    renderDashboard,
    renderMessages,
    renderUsers,
    renderRoles,
    renderTopDeck,
    renderServers,
    renderCommands,
    renderLanding,
    renderProfile,
    renderPublicProfile,
    renderCards,
    handleApi,
    handleUserUpdate,
    handleRoleRulesUpdate,
    handleUserStatusToggle,
    handleLogout,
    handleLogin
} = require('./controller/router')

const {redis, redisStore, secure} = require('./controller/redis')
const cookieMaxAge = parseInt(process.env.COOKIE_MAX_AGE) || 30 * 24 * 60 * 60 * 1000
const webRateLimitWindow = parseInt(process.env.WEB_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000
const webRateLimitMax = parseInt(process.env.WEB_RATE_LIMIT_MAX, 10) || 300
const webRateLimiter = rateLimit({
    windowMs: webRateLimitWindow,
    max: webRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
})

//frontend
app.use('/static', express.static('src/js'))
app.use('/assets', express.static(__dirname + '/assets'))
app.use(favicon(__dirname + '/assets/favicon.ico'))
app.set('view engine', 'pug')
app.set('views', __dirname + '/views')
app.use(compression())
app.use(express.urlencoded({ extended: false }))
app.use(express.json())
//cloud hosting
app.set('trust proxy', 1)

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
app.use(lusca.csrf())

app.use((req, res, next) => {
    res.locals.currentPath = req.path || '/'
    next()
})


//start listening for messages
app.listen(port, () => console.log(`Katyusha-Bot is listening at :${port}`))

// WEB ROUTES
app.get('/', webRateLimiter, isAuthenticated, renderDashboard)
app.get('/', webRateLimiter, renderLanding)
app.get('/auth', webRateLimiter, renderAuth)
app.post('/login', webRateLimiter, handleLogin)
app.post('/logout', webRateLimiter, handleLogout)
app.get('/commands', webRateLimiter, isAuthenticated, requireManager, renderCommands)
app.get('/messages', webRateLimiter, isAuthenticated, requireManager, renderMessages)
app.get('/users', webRateLimiter, isAuthenticated, requireManager, renderUsers)
app.post('/users/:id', webRateLimiter, isAuthenticated, requireManager, handleUserUpdate)
app.post('/users/:id/status', webRateLimiter, isAuthenticated, requireManager, handleUserStatusToggle)
app.get('/roles', webRateLimiter, isAuthenticated, requireGod, renderRoles)
app.post('/roles', webRateLimiter, isAuthenticated, requireGod, handleRoleRulesUpdate)
app.get('/profile', webRateLimiter, isAuthenticated, renderProfile)
app.get('/profile/:id', webRateLimiter, (req, res) => renderPublicProfile(req, res, client))
app.get('/servers', webRateLimiter, (req, res) => renderServers(req, res, servers))
app.get('/cards', webRateLimiter, renderCards)
app.get('/topdeck', webRateLimiter, renderTopDeck)
app.get('/api/:method', webRateLimiter, handleApi)

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
    telegramClient.on('callback_query', ctx => onTelegramCallback(ctx))
    telegramClient.catch(onTelegramError)

    console.log('Telegram client started')
    await telegramClient.launch()
}

function onTelegramText(ctx, redis) {

    requestQueue.enqueue(async function handleTelegramRequest() {
        await telegramHandler(ctx, redis)

    })


}

function onTelegramCallback(ctx) {

    requestQueue.enqueue(async function handleTelegramCallback() {
        await telegramCallbackHandler(ctx)
    })

}

//start Telegram-Bot's session if TOKEN is set
if (telegramClient) startTelegramClient().then()

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
