const {
    getAllSynonyms,
    getUser,
    getMessages,
    getLastDayMessages,
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
    let title = 'Bot commands in the last 24 hours'
    let messages = []

    if (!req.session.user.isManager) {
        res.send('Not permitted')
        return
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