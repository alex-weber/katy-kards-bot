const express = require('express')
const app = express()
const port = parseInt(process.env.PORT) || 3000
app.use('/static', express.static('src/js'))
//session
const session = require('express-session')
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

//redis cache
const { createClient } = require('redis')
const redis = createClient({url: process.env.REDISCLOUD_URL})
redis.connect().then(()=>{ console.log('REDIS Client Connected') })
const RedisStore = require("connect-redis").default
// Initialize store.
let redisStore = new RedisStore({
    client: redis,
    prefix: "katyusha:",
})
//start listening for messages
app.listen(port, () => console.log(`Discord-Bot is listening at :${port}`))

const {getServerList, getUptimeStats} = require("./tools/stats")
const {isManager} = require("./tools/search")
const {getAllSynonyms, getUser} = require('./database/db')
//auth
app.use(session({
    store: redisStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true if you are using HTTPS
}))
// middleware to test if authenticated
function isAuthenticated (req, res, next) {
    if (req.session.user) next()
    else next('route')
}
// this is only called when there is an authentication user due to isAuthenticated
app.get('/', isAuthenticated, function (req, res) {
    res.render('index', {
        title: 'Welcome, ' + req.session.user.username + '!',
        user: req.session.user,
        loginLink: false
    })
})
//this one is for not auth users
app.get('/', (req, res) =>
    res.render('index', {
        title: 'Katyusha Kards Bot',
        stats: {
            test: 'Welcome to Katyusha Kards Bot',
            test2: 'Here are some bot\'s statistics',
        },
        loginLink: process.env.DISCORD_AUTH_URL,
        user: null,
    }))
app.get('/auth', async (req, res) => {
    res.render('auth', {
        title: 'Discord User Auth',
    })
})
//login
app.get('/login', async (req, res, next) => {

    const tokenType = req.query.tokenType
    const accessToken = req.query.accessToken

    let user = await fetch('https://discord.com/api/users/@me', {
        headers: {
            authorization: `${tokenType} ${accessToken}`,
        },
    })
    user = await user.json()
    //console.log(user.id, user.username, user.avatar)
    let dbUser = await getUser(user.id)
    if (isManager(dbUser))
    {
        // regenerate the session, which is good practice to help
        // guard against forms of session fixation
        await req.session.regenerate(async function (err)
        {
            if (err) next(err)
            // store user information in session
            req.session.user = user
            //console.log('setting user session')
            // save the session before redirection to ensure page
            // load does not happen before session is saved
            await req.session.save(function (err)
            {
                if (err) return next(err)
                console.log()
                res.redirect('/')
            })
        })
    }
    else res.redirect('/')

})

app.get('/logout', function (req, res, next) {
    // logout logic

    // clear the user from the session object and save.
    req.session.user = null
    req.session.save(function (err) {
        if (err) next(err)

        // regenerate the session, which is good practice to help
        // guard against forms of session fixation
        req.session.regenerate(function (err) {
            if (err) next(err)
            res.redirect('/')
        })
    })
})

app.get('/synonyms', isAuthenticated, async (req, res) => {
    const synonyms = await getAllSynonyms()
    res.render('synonyms', {
        title: 'Synonyms',
        synonyms: synonyms,
        user: req.session.user
    })
})
//uptime
app.get('/uptime', async (req, res) =>
{
    let APIres = await getUptimeStats()

    return res.render('uptime', {
        title: 'Uptime Stats',
        stats: APIres.data,
        user: req.session.user,
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
        user: req.session.user
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
