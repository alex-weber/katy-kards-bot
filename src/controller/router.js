const {
    getAllSynonyms,
    getUser,
    getUserById,
    getMessages,
    getUserMessages,
    getProfileStats,
    daysAgoString,
} = require('../database/db')

const {isManager} = require("../tools/search")
const {resolveAvatarUrl} = require("../tools/avatar")
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

// middleware to restrict a route to managers
function requireManager(req, res, next) {
    if (req.session.user && req.session.user.isManager) return next()
    res.status(403).send('Not permitted')
}

// Resolve the requested date range. Only logged-in users may change the
// dates; anonymous callers are always clamped to the default window, so they
// cannot trigger expensive wide-range queries via the API.
function resolveRange(req) {
    const isLoggedIn = !!req.session.user
    const { from, to } = req.query

    return {
        from: (isLoggedIn && from) ? from : daysAgoString(30),
        to: (isLoggedIn && to) ? to : getTodayString()
    }
}

function renderPage(req, res, { title, user, loginLink }) {
    const { from, to } = resolveRange(req)
    const { username, command } = req.query

    res.render('index', {
        title,
        user,
        loginLink,
        from,
        to,
        canFilter: !!user,
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

    const synonyms = await getAllSynonyms()

    res.render('synonyms', {
        title: 'Custom Bot Commands',
        synonyms,
        user: req.session.user
    })
}

async function renderMessages(req, res) {

    let { from, to, page = '1', username, command } = req.query

// --- Validation & sanitation ---
    const pageNumber = Number.isInteger(parseInt(page, 10)) && parseInt(page, 10) > 0
        ? parseInt(page, 10)
        : 1

    const pageSize = 50 // fixed or enforce a max if dynamic

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

// Build the Discord CDN avatar URL for a session user (null when unavailable).
function sessionAvatarUrl(sessionUser) {
    if (!sessionUser || !sessionUser.avatar) return null
    return `https://cdn.discordapp.com/avatars/${sessionUser.id}/${sessionUser.avatar}.webp`
}

// Shared profile renderer. `history` (the private 24h command list) is only
// passed for the viewer's own profile.
function renderProfileView(req, res, { displayName, avatarUrl, stats, history, isOwn }) {
    res.render('profile', {
        title: 'Profile',
        user: req.session.user,
        displayName,
        avatarUrl,
        stats,
        history: history || null,
        isOwn
    })
}

// Render the logged-in viewer's own profile (stats + private 24h history) for
// the given internal user id.
async function renderOwnProfile(req, res, dbUserId) {
    const messages = await getUserMessages(dbUserId)

    renderProfileView(req, res, {
        displayName: req.session.user.username,
        avatarUrl: sessionAvatarUrl(req.session.user),
        stats: {
            total: messages.totalCount,
            lastMonth: messages.lastMonthMessagesCount,
            lastDay: messages.lastDayMessages.length
        },
        history: messages.lastDayMessages,
        isOwn: true
    })
}

// The logged-in user's own profile.
async function renderProfile(req, res) {
    const user = await getUser(req.session.user.id)
    return renderOwnProfile(req, res, user.id)
}

// Public profile by internal user id (linked from the dashboard). Only the
// stat counts are shown for other users; the command history stays private.
async function renderPublicProfile(req, res, client) {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(404).send('User not found')
    }

    const target = await getUserById(id)
    if (!target) return res.status(404).send('User not found')

    // The viewer's own profile (matched by Discord id) gets the full view.
    if (req.session.user && req.session.user.id === target.discordId) {
        return renderOwnProfile(req, res, target.id)
    }

    const stats = await getProfileStats(target.id)
    renderProfileView(req, res, {
        displayName: target.name || 'Unknown',
        avatarUrl: await resolveAvatarUrl(client, target.discordId),
        stats,
        history: null,
        isOwn: false
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
    const { page, pageSize, username, command } = req.query
    // Anonymous callers are clamped to the default window; only logged-in
    // users may request an arbitrary date range.
    const { from, to } = resolveRange(req)

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
    requireManager,
    renderAuth,
    renderDashboard,
    renderMessages,
    renderCommands,
    renderServers,
    renderLanding,
    renderProfile,
    renderPublicProfile,
    renderCards,
    handleApi,
    handleLogout,
    handleLogin
}