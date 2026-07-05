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
    startDiscordAuth,
    renderDashboard,
    renderMessages,
    renderUsers,
    renderRoles,
    renderSystem,
    renderTopDeck,
    renderServers,
    renderCommands,
    renderLanding,
    renderProfile,
    renderPublicProfile,
    renderCards,
    renderTerms,
    renderPrivacy,
    handleApi,
    handleUserUpdate,
    handleRoleRulesUpdate,
    handleSystemSettingsUpdate,
    handleUserStatusToggle,
    handleLogout,
    handleLogin
} = require('./controller/router')

const {redis, redisStore, secure} = require('./controller/redis')
const {startMemoryUsageSampler} = require('./tools/systemMetrics')
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
// lusca.csrf() writes a CSRF secret into req.session on every request, which
// makes the session "non-empty" and defeats saveUninitialized:false — causing a
// new Redis session key for every anonymous visitor (bots, UptimeRobot, etc.).
// Only engage CSRF when a session already belongs to a logged-in user, or on the
// login entrypoints where an anonymous user legitimately needs a token.
const csrf = lusca.csrf()
const csrfPaths = new Set(['/auth', '/login'])
app.use((req, res, next) => {
    // Normalize a trailing slash so e.g. the Discord redirect_uri "/auth/" still
    // matches "/auth" (Express's non-strict routing matches both for the route).
    const path = req.path.length > 1 && req.path.endsWith('/')
        ? req.path.slice(0, -1)
        : req.path
    const needsCsrf = (req.session && req.session.user) || csrfPaths.has(path)
    if (needsCsrf) return csrf(req, res, next)
    next()
})

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
// Seeds the session/CSRF cookie first-party, then redirects to Discord OAuth.
app.get('/login', webRateLimiter, startDiscordAuth)
app.post('/login', webRateLimiter, handleLogin)
app.post('/logout', webRateLimiter, handleLogout)
app.get('/commands', webRateLimiter, isAuthenticated, requireManager, renderCommands)
app.get('/messages', webRateLimiter, isAuthenticated, requireManager, renderMessages)
app.get('/users', webRateLimiter, isAuthenticated, requireManager, renderUsers)
app.post('/users/:id', webRateLimiter, isAuthenticated, requireManager, handleUserUpdate)
app.post('/users/:id/status', webRateLimiter, isAuthenticated, requireManager, handleUserStatusToggle)
app.get('/roles', webRateLimiter, isAuthenticated, requireGod, renderRoles)
app.post('/roles', webRateLimiter, isAuthenticated, requireGod, handleRoleRulesUpdate)
app.get('/system', webRateLimiter, isAuthenticated, requireManager, renderSystem)
app.post('/system', webRateLimiter, isAuthenticated, requireManager, handleSystemSettingsUpdate)
app.get('/profile', webRateLimiter, isAuthenticated, renderProfile)
app.get('/profile/:id', webRateLimiter, (req, res) => renderPublicProfile(req, res, client))
app.get('/servers', webRateLimiter, (req, res) => renderServers(req, res, servers))
app.get('/cards', webRateLimiter, renderCards)
app.get('/topdeck', webRateLimiter, renderTopDeck)
app.get('/terms', webRateLimiter, renderTerms)
app.get('/privacy', webRateLimiter, renderPrivacy)
app.get('/api/:method', webRateLimiter, handleApi)

let servers = [] //we get them when Discord client is ready
startMemoryUsageSampler(redis)

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
    console.log('exiting on', event)
    process.exit(code)
}
