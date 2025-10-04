const {
    getAllSynonyms,
    getUser,
    getMessages,
    getUserMessages,
    daysAgoString,
} = require('../database/db')

const {isManager} = require("../tools/search")
const axios = require('axios')
//API
const API = require('../controller/api')

function getTodayString() {
    return new Date().toISOString().split('T')[0]
}

// middleware to test if authenticated
function isAuthenticated(req, res, next) {
    if (req.session.user) next()
    else next('route')
}

function renderPage(req, res, { title, user, loginLink }) {
    let { from, to, username, command } = req.query
    from = from || daysAgoString(30)
    to = to || getTodayString()

    res.render('index', {
        title,
        user,
        loginLink,
        from,
        to,
        username: username || '',
        command: command || ''
    })
}

// Usage:
function renderDashboard(req, res) {
    renderPage(req, res, {
        title: 'Dashboard',
        user: req.session.user,
        loginLink: false
    })
}

function renderLanding(req, res) {
    renderPage(req, res, {
        title: 'Katyusha Kards Bot',
        user: null,
        loginLink: process.env.DISCORD_AUTH_URL
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

    if (!req.session.user.isManager) {
        res.send('Not permitted')
        return
    }

    const synonyms = await getAllSynonyms()

    res.render('synonyms', {
        title: 'Custom Bot Commands',
        synonyms,
        user: req.session.user
    })
}

async function renderMessages(req, res) {

    if (!req.session.user.isManager) {
        return res.send('Not permitted')
    }

    let { from, to, page = 1, username, command } = req.query

// --- Validation & sanitation ---
    const pageNumber = Number.isInteger(parseInt(page, 10)) && parseInt(page, 10) > 0
        ? parseInt(page, 10)
        : 1

    const pageSize = 50 // fixed, or enforce a max if dynamic

// Validate dates
    let toDate = new Date()
    if (to && !isNaN(Date.parse(to))) {
        toDate = new Date(to)
    }

    let fromDate = new Date(toDate.getTime() - 24 * 60 * 60 * 1000) // default: last 24h
    if (from && !isNaN(Date.parse(from))) {
        fromDate = new Date(from)
    }

// Normalize string inputs (trim & length limit)
    username = typeof username === 'string' ? username.trim().slice(0, 20) : ''
    command = typeof command === 'string' ? command.trim().slice(0, 100) : ''

// --- Values for <input type="date"> (always YYYY-MM-DD) ---
    const fromISO = fromDate.toISOString().split('T')[0]
    const toISO = toDate.toISOString().split('T')[0]

    const { messages, totalCount } = await getMessages(
        {
            from: fromISO,
            to: toISO,
            page: pageNumber,
            pageSize,
            username,
            command
        }
    )
    const totalPages = Math.max(1, Math.ceil((totalCount || 0) / pageSize))

    const maxAge = 5 * 60
    res.set('Cache-Control', `public, max-age=${maxAge}`)

    res.render('messages', {
        title: 'Bot commands',
        messages,
        user: req.session.user,
        page: pageNumber,
        pageSize,
        totalPages,
        totalCount,
        from: fromISO,
        to: toISO,
        username,
        command
    })
}

async function renderProfile(req, res) {
    const user = await getUser(req.session.user.id)
    const messages = await getUserMessages(user.id)

    res.render('profile', {
        title: 'Profile',
        messages,
        user: req.session.user
    })
}

async function renderCards(req, res) {

    res.render('cards', {
        title: 'Cards',
        user: req.session.user,
    })
}

async function handleApi(req, res) {
    const { method } = req.params
    const { from, to, page, pageSize, username, command } = req.query

    const apiResponse = await API.run(method, {
        from,
        to,
        page,
        pageSize,
        username,
        command
    })

    res.json(apiResponse)
}


async function renderServers(req, res, servers) {

    res.render('servers', {
        title: 'Discord servers',
        servers: servers,
        user: req.session.user
    })
}

module.exports = {
    isAuthenticated,
    renderAuth,
    renderDashboard,
    renderMessages,
    renderCommands,
    renderServers,
    renderLanding,
    renderProfile,
    renderCards,
    handleApi,
    handleLogout,
    handleLogin
}