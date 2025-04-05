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
function isAuthenticated (req, res, next) {
    if (req.session.user) next()
    else next('route')
}
// for authenticated users only
app.get('/', isAuthenticated,  (req, res) => {
    res.render('index', {
        title: 'Dashboard',
        user: req.session.user,
        loginLink: false
    })
})
//this one is for not auth users
app.get('/', (req, res) =>
    res.render('index', {
        title: 'Katyusha Kards Bot',
        loginLink: process.env.DISCORD_AUTH_URL,
        user: null,
    }))
app.get('/auth', async (req, res) =>
    res.render('auth', {
        title: 'Logging in...please wait',
    })
)
//login
app.get('/login', async (req, res, next) => {

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

    await req.session.regenerate(async err =>
    {
        if (err) next(err)
        // store user information in session
        req.session.user = user
        await req.session.save( err =>
        {
            if (err) return next(err)
            console.log()
            res.redirect('/')
        })
    })

})

app.get('/logout',  (req, res, next) => {
    // clear the user from the session object and save.
    req.session.user = null
    req.session.save( err => {
        if (err) next(err)
        req.session.regenerate( err => {
            if (err) next(err)
            res.redirect('/')
        })
    })
})

app.get('/commands', isAuthenticated, async (req, res) => {

    let title = 'Custom Bot Commands'
    let synonyms = []
    if (!req.session.user.isManager) title = 'Not permitted'
    else synonyms = await getAllSynonyms()

    res.render('synonyms', {
        title: title,
        synonyms: synonyms,
        user: req.session.user
    })
})

app.get('/messages', isAuthenticated, async (req, res) => {

    let messages = []
    let title = 'Bot commands in the last 24 hours'
    if (!req.session.user.isManager) title = 'Not permitted'
    else messages = await getLastDayMessages()

    res.render('messages', {
        title: title,
        messages: messages,
        user: req.session.user
    })
})

app.get('/profile', isAuthenticated, async (req, res) => {
    const user = await getUser(req.session.user.id)
    const messages = await getMessages(user.id, 0, 100000)

    const oneMonthAgo = new Date()
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const lastMonthMessages = messages.filter(m => {
        const createdTimestamp = Date.parse(m.timestamp)

        return createdTimestamp > oneMonthAgo.getTime()
    })

    const lastDayMessages = messages.filter(m => {
        const createdTimestamp = Date.parse(m.timestamp)

        return createdTimestamp > oneDayAgo.getTime()
    })

    res.render('profile', {
        title: 'Profile',
        messages: messages,
        lastMonthMessages: lastMonthMessages,
        lastDayMessages: lastDayMessages,
        user: req.session.user
    })
})

//uptime
app.get('/uptime', async (req, res) =>
{
    let APIres = await getUptimeStats()
    if (!APIres) return res.redirect('/')

    return res.render('uptime', {
        title: 'Uptime Stats',
        stats: APIres.data,
        user: req.session.user,
    })
})

//API
app.get('/api/:method', async (req, res) => {
    const method = req.params.method
    const apiResponse = await API.run(method)
    res.json(apiResponse)
})

//Discord-Bot login event
client.on('ready', () =>
{
    console.log(`Logged in as ${client.user.tag}`, 'Server count: ' + client.guilds.cache.size)
    const guildNames = getServerList(client)
    app.get('/servers', (req, res) => res.render('servers', {
        title: 'Discord servers',
        servers: guildNames,
        user: req.session.user
    }))
    //console.log(guildNames)
    client.user.setActivity(client.guilds.cache.size + ' servers', { type: ActivityType.Watching})
})
//trigger on new messages
client.on('messageCreate', async message => discordHandler(message, client, redis))
//trigger on interactions
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return
    if (interaction.customId.startsWith('next_button'))
    {
        const message = interaction.message
        message.buttonId = interaction.customId
        // remove the button
        await interaction.message.edit({ components: [] })

        const user = await getUser(interaction.user.id)
        const content = translate(user.language,'fetching')
        await interaction.reply({
            content: content,
            flags: MessageFlags.Ephemeral
        })

        return await discordHandler(message, client, redis)
    }

})
//start Discord-Bot's session
client.login(process.env.DISCORD_TOKEN).then(() =>
{
    console.log('Discord client started')
})
//start Telegram-Bot's session if TOKEN is set
if (telegramClient)
{
    telegramClient.on(telegramMessage('text'), ctx => {
        requestQueue.enqueue(async () =>
            await telegramHandler(ctx, redis)
        )
    })

    telegramClient.catch((err) => {
        console.error('telegramAPI error occurred:', err)
        if (err.on.payload.chat_id)
        {
            telegramClient.telegram.sendMessage(err.on.payload.chat_id,
                'Error: file upload failed')
        }

    })
    telegramClient.launch()
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