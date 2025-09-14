const {
    getAllSynonyms,
    getUser,
    getMessages,
    getUserMessages,
} = require('../database/db')

const {isManager} = require("../tools/search")
const axios = require('axios')
//API
const API = require('../controller/api')


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
        res.send('Not permitted')
        return
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
    const title = 'Last bot commands'
    if (!req.session.user.isManager) {
        return res.send('Not permitted')
    }

    let { from, to, page = 1 } = req.query
    const pageNumber = Math.max(1, parseInt(page, 10) || 1)
    const pageSize = 50

    // Default dates: last 24 hours
    let toDate = to ? new Date(to) : new Date()
    let fromDate = from ? new Date(from) : new Date(toDate.getTime() - 24 * 60 * 60 * 1000)

    // Values for <input type="date"> (always YYYY-MM-DD)
    const fromISO = fromDate.toISOString().split('T')[0]
    const toISO = toDate.toISOString().split('T')[0]

    const { messages, totalCount } = await getMessages(
        {
            from: fromISO,
            to: toISO,
            page: pageNumber,
            pageSize
        }
    )
    const totalPages = Math.max(1, Math.ceil((totalCount || 0) / pageSize))

    const maxAge = 5 * 60
    res.set('Cache-Control', `public, max-age=${maxAge}`)

    res.render('messages', {
        title,
        messages,
        user: req.session.user,
        page: pageNumber,
        pageSize,
        totalPages,
        from: fromISO,
        to: toISO
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
    const method = req.params.method
    const apiResponse = await API.run(method)
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