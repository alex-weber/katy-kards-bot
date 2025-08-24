const express = require('express')
const axios = require('axios')
const app = express()
const port = parseInt(process.env.PORT) || 3000
app.use('/static', express.static('src/js'))
//session
const session = require('express-session')
const favicon = require('serve-favicon')
app.use(favicon(__dirname + '/assets/favicon.ico'))
app.set('view engine', 'pug')
app.set('views', __dirname + '/views')
//cloud hosting
app.set('trust proxy', true)
const compression = require('compression')
app.use(compression())
//handlers
const {discordHandler} = require('./controller/discordHandler')
const {telegramHandler} = require('./controller/telegramHandler')
//discord
const {client} = require('./clients/discordClient.js')
const {ActivityType, MessageFlags} = require('discord.js')
//telegram
const {telegramClient, telegramMessage} = require('./clients/telegram')

//API
const API = require('./controller/api')
//redis cache
const { createClient } = require('redis')
const redis = createClient({url: process.env.REDISCLOUD_URL})
redis.connect().then(()=>{ console.log('REDIS Client Connected') })
const RedisStore = require("connect-redis").default
// Initialize store.
const secure = process.env.NODE_ENV === 'production'
const cachePrefix = secure ? 'katy-prod:' : 'katy-dev:'
const redisStore = new RedisStore({
    client: redis,
    prefix: cachePrefix,
})
//start listening for messages
app.listen(port, () => console.log(`Discord-Bot is listening at :${port}`))
//for web pages
const {getServerList, getUptimeStats} = require("./tools/stats")
const {isManager} = require("./tools/search")
const {
    getAllSynonyms,
    getUser,
    getMessages,
    getLastDayMessages,
    disconnect
} = require('./database/db')
const {translate} = require("./tools/translation/translator")
//session
const cookieMaxAge = parseInt(process.env.COOKIE_MAX_AGE) || 30 * 24 * 60 * 60 * 1000

const RequestQueue = require("./tools/queue")
const requestQueue = new RequestQueue()

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
// middleware to test if authenticated
function isAuthenticated(req, res, next) {
    if (req.session.user) next()
    else next('route')
}

function renderDashboard(req, res) {
    res.render('index', {
        title: 'Dashboard',
        user: req.session.user,
        loginLink: false
    })
}

function renderLanding(req, res) {
    res.render('index', {
        title: 'Katyusha Kards Bot',
        loginLink: process.env.DISCORD_AUTH_URL,
        user: null,
    })
}

function renderAuth(req, res) {
    res.render('auth', {
        title: 'Logging in...please wait',
    })
}

async function handleLogin(req, res, next) {
    try {
        const tokenType = req.query.tokenType
        const accessToken = req.query.accessToken

        let user = await axios.get('https://discord.com/api/users/@me', {
            headers: {
                authorization: `${tokenType} ${accessToken}`,
            },
        })

        user = user.data
        let dbUser = await getUser(user.id)
        if (isManager(dbUser)) user.isManager = true

        req.session.regenerate(async function onRegenerate(err) {
            if (err) return next(err)

            req.session.user = user

            req.session.save(function onSave(err) {
                if (err) return next(err)
                res.redirect('/')
            })
        })
    } catch (err) {
        next(err)
    }
}

function handleLogout(req, res, next) {
    req.session.user = null
    req.session.save(function onSave(err) {
        if (err) return next(err)
        req.session.regenerate(function onRegenerate(err) {
            if (err) return next(err)
            res.redirect('/')
        })
    })
}

async function renderCommands(req, res) {
    let title = 'Custom Bot Commands'
    let synonyms = []

    if (!req.session.user.isManager) {
        title = 'Not permitted'
    } else {
        synonyms = await getAllSynonyms()
    }

    res.render('synonyms', {
        title,
        synonyms,
        user: req.session.user
    })
}

async function renderMessages(req, res) {
    let title = 'Bot commands in the last 24 hours'
    let messages = []

    if (!req.session.user.isManager) {
        title = 'Not permitted'
    } else {
        messages = await getLastDayMessages()
    }

    res.render('messages', {
        title,
        messages,
        user: req.session.user
    })
}

async function renderProfile(req, res) {
    const user = await getUser(req.session.user.id)
    const messages = await getMessages(user.id)

    res.render('profile', {
        title: 'Profile',
        messages,
        user: req.session.user
    })
}

async function renderUptime(req, res) {
    const APIres = await getUptimeStats()
    if (!APIres) return res.redirect('/')

    res.render('uptime', {
        title: 'Uptime Stats',
        stats: APIres.data,
        user: req.session.user,
    })
}

async function handleApi(req, res) {
    const method = req.params.method
    const apiResponse = await API.run(method)
    res.json(apiResponse)
}

// ROUTES
app.get('/', isAuthenticated, renderDashboard)
app.get('/', renderLanding)
app.get('/auth', renderAuth)
app.get('/login', handleLogin)
app.get('/logout', handleLogout)
app.get('/commands', isAuthenticated, renderCommands)
app.get('/messages', isAuthenticated, renderMessages)
app.get('/profile', isAuthenticated, renderProfile)
app.get('/uptime', renderUptime)
app.get('/api/:method', handleApi)



//Discord-Bot login event
function onClientReady() {
    console.log(
        `Logged in as ${client.user.tag}`,
        'Server count: ' + client.guilds.cache.size
    )

    const guildNames = getServerList(client)

    function renderServers(req, res) {
        res.render('servers', {
            title: 'Discord servers',
            servers: guildNames,
            user: req.session.user
        })
    }

    app.get('/servers', renderServers)

    client.user.setActivity(
        client.guilds.cache.size + ' servers',
        { type: ActivityType.Watching }
    )
}

async function onMessageCreate(message) {
    await discordHandler(message, client, redis)
}

async function onInteractionCreate(interaction) {
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