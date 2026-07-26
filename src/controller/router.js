const {
    getAllSynonyms,
    getSynonym,
    createSynonym,
    updateSynonym,
    deleteSynonym,
    getUser,
    getUserById,
    getUsers,
    getUserStatusCounts,
    createUserAudit,
    getRecentUserAudits,
    getMessages,
    getUserMessages,
    getProfileStats,
    updateUserAdminFields,
    getTopDeckRanking,
} = require('../database/db')

const path = require('path')
const fs = require('fs')
const multer = require('multer')
const {isManager, checkSynonymKey} = require("../tools/search")
const {invalidateSynonymCache} = require('./synonymCache')
const {uploadImageFile} = require('../tools/imageUpload')
const {safeImageUrl} = require('../tools/imageUrl')
const {resolveAvatarUrl} = require("../tools/avatar")
const {getSyncState, startSync} = require('../tools/syncRunner')
const {buildSyncView} = require('../tools/syncFormat')
const {
    ROLE,
    ROLE_OPTIONS,
    EDITABLE_RULE_ROLES,
    normalizeRole,
    roleToDbValue,
    roleLabel,
    isGod,
    canAssignRole,
    assignableRoleOptions,
    getRoleRules,
    saveRoleRules,
    normalizeRuleSet,
} = require("../tools/roles")
const {redis, cachePrefix: webCachePrefix} = require('../controller/redis')
const {cacheKeyPrefix} = require('../controller/messageCache')
const {
    buildSystemPageData,
    saveMemoryThresholdMb,
    saveNodeMemoryAvailableMb,
    saveRedisMemoryAvailableMb,
} = require('../tools/systemMetrics')
const axios = require('axios')
//API
const API = require('../controller/api')
const STATS_PERIOD_OPTIONS = [
    {value: 'daily', label: 'Last 30 days'},
    {value: 'monthly', label: 'Last 12 months'},
    {value: 'quarterly', label: 'Last 8 quarters'},
    {value: 'yearly', label: 'All-time'},
]
const STATS_PERIODS = STATS_PERIOD_OPTIONS.map(option => option.value)
const topDeckPageExpiration = parseInt(process.env.CACHE_TOPDECK_PAGE_EXPIRE, 10) || 60 * 5

async function refreshSessionUser(req) {
    if (!req.session.user || !req.session.user.id) return null

    const dbUser = await getUser(req.session.user.id)
    req.session.user.role = dbUser.role
    req.session.user.isManager = isManager(dbUser)

    return req.session.user
}

// middleware to test if authenticated
async function isAuthenticated(req, res, next) {
    if (!req.session.user) return next('route')
    if (req.session.user.role === undefined) await refreshSessionUser(req)
    next()
}

// middleware to restrict a route to managers
async function requireManager(req, res, next) {
    if (req.session.user) await refreshSessionUser(req)
    if (req.session.user && req.session.user.isManager) return next()
    res.status(403).send('Not permitted')
}

async function requireGod(req, res, next) {
    if (req.session.user) await refreshSessionUser(req)
    if (req.session.user && isGod(req.session.user)) return next()
    res.status(403).send('Not permitted')
}

/**
 * The same check requireManager makes, for the JSON endpoints the dashboard's
 * scripts call: they are already behind requireManager, so this only answers in
 * the shape their fetch() callers expect (and keeps them safe if a route is
 * ever wired up without the middleware).
 *
 * @param req
 * @param res
 * @returns {boolean} true when the request was answered with a 403
 */
function denyNonManager(req, res) {
    if (req.session.user && req.session.user.isManager) return false

    res.status(403).json({error: 'Not permitted'})
    return true
}

function resolveStatsPeriod(req) {
    return STATS_PERIODS.includes(req.query.period) ? req.query.period : 'daily'
}

function renderPage(req, res, { title, user, loginLink }) {
    const period = resolveStatsPeriod(req)
    const { username, command } = req.query

    res.render('index', {
        title,
        user,
        loginLink,
        period,
        periods: STATS_PERIOD_OPTIONS,
        canFilter: true,
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
        loginLink: '/login'
    })
}

// Starts the Discord OAuth flow. The csrf middleware in front of this route
// seeds the session + CSRF cookie first-party (before we leave for Discord), so
// the cookie reliably survives the cross-site redirect back to /auth and the
// subsequent POST /login. Without this first-party seed, a cookie set on the
// post-redirect /auth response is treated as third-party and gets dropped.
function startDiscordAuth(req, res) {
    res.redirect(process.env.DISCORD_AUTH_URL)
}

function renderAuth(req, res) {
    res.render('auth', {
        title: 'Logging in...please wait',
    })
}

async function handleLogin(req, res, next) {
    try {
        const tokenType = req.body.tokenType
        const accessToken = req.body.accessToken

        if (!tokenType || !accessToken) {
            return res.status(400).send('Missing login token')
        }

        let user = await axios.get('https://discord.com/api/users/@me', {
            headers: {
                authorization: `${tokenType} ${accessToken}`,
            },
        })

        user = user.data
        let dbUser = await getUser(user.id)
        user.role = dbUser.role
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


// Temp home for admin-uploaded synonym images before they're re-hosted by
// uploadImageFile() — same directory the Discord-attachment path already uses,
// so no new gitignore entry needed.
const synonymUploadDir = path.join(__dirname, '../tmp/downloads')

// Doubles as the allowlist for fileFilter: the extension comes from the
// mimetype rather than from the client-supplied original name, so nothing
// user-controlled ever reaches the temp file's path.
const SYNONYM_IMAGE_EXTENSIONS = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
}

const synonymImageUploadMiddleware = multer({
    storage: multer.diskStorage({
        destination: synonymUploadDir,
        filename: (req, file, cb) => {
            const ext = SYNONYM_IMAGE_EXTENSIONS[file.mimetype]
            cb(null, `synadmin_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`)
        },
    }),
    limits: {fileSize: 8 * 1024 * 1024},
    fileFilter: (req, file, cb) => {
        cb(null, Object.hasOwn(SYNONYM_IMAGE_EXTENSIONS, file.mimetype))
    },
}).single('image')

/**
 * multer reports failures (wrong field name, over the size limit, …) by
 * calling `next(err)` — with no global Express error handler in this app,
 * that would otherwise fall through to a default HTML error page instead of
 * the JSON response commands.js's fetch call expects. Catch it here instead.
 *
 * @param req
 * @param res
 * @param next
 */
function synonymImageUpload(req, res, next) {
    synonymImageUploadMiddleware(req, res, error => {
        if (!error) return next()

        const message = error.code === 'LIMIT_FILE_SIZE'
            ? 'Image is too large (max 8MB)'
            : 'Upload failed'
        res.status(400).json({error: message})
    })
}

/**
 * Build the stored `value` JSON for a synonym from the web form's fields.
 * Mirrors handleSynonym()'s convention (src/tools/search.js): a "text:"
 * prefix on `content` means a literal reply, its absence means a search
 * redirect/alias — so a redirect's content is stored without the prefix.
 *
 * @param contentType 'text' | 'redirect'
 * @param text the reply body (used when contentType === 'text')
 * @param redirectTarget the alias target (used when contentType === 'redirect')
 * @param files array of already-hosted image URLs
 * @returns {string|null} JSON string, or null when there's nothing to store
 */
function buildSynonymValue({contentType, text, redirectTarget, files}) {
    const value = {}
    if (contentType === 'redirect') {
        const target = sanitizeText(redirectTarget, 200)
        if (target) value.content = target
    } else {
        const body = sanitizeText(text, 2000)
        if (body) value.content = 'text:' + body
    }
    if (Array.isArray(files) && files.length) value.files = files

    if (!value.content && !value.files) return null

    return JSON.stringify(value)
}

/**
 * Parse a stored synonym `value` into web-form-friendly fields. Handles the
 * legacy bare-string formats (resolveSynonym() in synonymCommands.js has to
 * deal with the same three: a raw image URL, a bare "text:" string, or a bare
 * redirect target) in addition to the canonical JSON shape.
 *
 * @param rawValue
 * @returns {{contentType: string, text: string, redirectTarget: string, files: string[]}}
 */
function parseSynonymValue(rawValue) {
    let content = ''
    let files = []

    if (typeof rawValue === 'string' && rawValue.startsWith('{')) {
        try {
            const parsed = JSON.parse(rawValue)
            content = typeof parsed.content === 'string' ? parsed.content : ''
            files = Array.isArray(parsed.files) ? parsed.files : []
        } catch {
            content = rawValue
        }
    } else if (typeof rawValue === 'string' && rawValue.startsWith('http')) {
        files = [rawValue]
    } else if (typeof rawValue === 'string') {
        content = rawValue
    }

    const isText = content.startsWith('text:')

    return {
        contentType: isText || !content ? 'text' : 'redirect',
        text: isText ? content.slice('text:'.length) : '',
        redirectTarget: !isText ? content : '',
        files,
    }
}

/**
 * Which of an existing synonym's files the admin left checked in the edit
 * form (unchecked ones are dropped; new uploads are appended by the caller).
 *
 * @param req
 * @param existingFiles
 * @returns {string[]}
 */
function resolveKeptSynonymFiles(req, existingFiles) {
    const keep = req.body.keepFiles
    if (keep === undefined) return []
    const kept = Array.isArray(keep) ? keep : [keep]

    return existingFiles.filter(file => kept.includes(file))
}

/**
 * New uploads arrive as hidden `files` inputs already populated by the
 * /commands/upload endpoint (see synonymImageUpload) — the actual binary
 * upload already happened client-side, so this is just reading form fields.
 *
 * They are put through safeImageUrl() rather than trusted: the form is the one
 * place an admin-supplied URL can enter a stored command, and every stored
 * file is later fetched server-side and posted back into a channel. A URL the
 * bot would refuse to download is dropped here instead of being saved.
 *
 * @param req
 * @returns {string[]}
 */
function resolveNewSynonymFiles(req) {
    const submitted = req.body.files
    if (!submitted) return []

    const files = []
    for (const url of Array.isArray(submitted) ? submitted : [submitted]) {
        const safe = typeof url === 'string' ? safeImageUrl(url) : null
        if (safe) {
            files.push(safe)
            continue
        }

        // Worth a line in the log because the admin gets no other sign: the
        // upload endpoint already returned a URL and the form showed the
        // thumbnail, so a drop here looks like a command that simply saved
        // without its image. By far the likeliest cause is the uploader's own
        // host missing from IMAGE_ALLOWED_HOSTS on this deployment.
        console.error(
            'Dropped a command image the bot would refuse to download.',
            'Is its host in IMAGE_ALLOWED_HOSTS? URL:',
            url)
    }

    return files
}

/**
 * The query a form's `returnTo` field carried, or nothing when it is missing
 * or points somewhere other than `path`. Handed back as parsed params rather
 * than a string so callers have to re-validate each value before it can reach
 * res.redirect() — the submitted string itself never gets there.
 *
 * @param req
 * @param path list route the field is allowed to point at
 * @returns {URLSearchParams}
 */
function parseReturnToQuery(req, path) {
    const submitted = typeof req.body?.returnTo === 'string' ? req.body.returnTo : ''
    const prefix = path + '?'

    return new URLSearchParams(submitted.startsWith(prefix) ? submitted.slice(prefix.length) : '')
}

/**
 * Rebuilds a list URL from `path` (a literal) plus already-validated values,
 * dropping empty ones. Nothing user-controlled reaches res.redirect() except
 * as a percent-encoded query value, so a tampered `returnTo` can't turn this
 * into an open redirect.
 *
 * @param res
 * @param path
 * @param entries
 */
function redirectToList(res, path, entries) {
    const params = new URLSearchParams()
    for (const [name, value] of entries) {
        if (value) params.set(name, String(value))
    }
    const query = params.toString()

    return res.redirect(query ? `${path}?${query}` : path)
}

/**
 * Back to the list, keeping the admin's search/page position when the form
 * carried one (same `returnTo` convention the user rows use).
 *
 * @param req
 * @param res
 */
function redirectBackToCommands(req, res) {
    const query = parseReturnToQuery(req, '/commands')

    return redirectToList(res, '/commands', [
        ['q', sanitizeText(query.get('q'), 100).toLowerCase()],
        ['type', SYNONYM_KINDS.includes(query.get('type')) ? query.get('type') : ''],
        ['page', query.has('page') ? sanitizePage(query.get('page')) : ''],
    ])
}

/**
 * Which flavor of command a stored value represents — drives both the `type`
 * filter and the badge shown in each row.
 *
 * @param parsed output of parseSynonymValue()
 * @returns {'text'|'redirect'|'image'}
 */
function synonymKind(parsed) {
    if (parsed.contentType === 'redirect') return 'redirect'
    if (!parsed.text && parsed.files.length) return 'image'

    return 'text'
}

const SYNONYM_KINDS = ['text', 'redirect', 'image']

/**
 * getAllSynonyms() has no filtering/paging of its own and the whole set is
 * small enough to hold in memory (it's already loaded in full elsewhere, see
 * search.js), so search and paging happen here rather than in the query.
 *
 * @param req
 * @param res
 * @returns {Promise<void>}
 */
async function renderCommands(req, res) {
    const search = sanitizeText(req.query.q, 100).toLowerCase()
    const type = SYNONYM_KINDS.includes(req.query.type) ? req.query.type : ''
    const pageSize = 20

    const all = (await getAllSynonyms())
        .map(synonym => {
            const parsed = parseSynonymValue(synonym.value)

            return {...synonym, parsed, kind: synonymKind(parsed)}
        })
        .sort((a, b) => a.key.localeCompare(b.key))

    const filtered = all.filter(synonym => {
        if (type && synonym.kind !== type) return false
        if (!search) return true

        return [synonym.key, synonym.parsed.text, synonym.parsed.redirectTarget]
            .some(field => field.toLowerCase().includes(search))
    })

    const totalCount = filtered.length
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
    const page = Math.min(sanitizePage(req.query.page), totalPages)

    res.render('synonyms', {
        title: 'Custom Bot Commands',
        synonyms: filtered.slice((page - 1) * pageSize, page * pageSize),
        totalCount,
        allCount: all.length,
        page,
        pageSize,
        totalPages,
        search,
        type,
        currentPath: req.path,
        user: req.session.user
    })
}

/**
 * Upload a single admin-provided image for a custom command, via the same
 * image host Discord attachments use. A dedicated JSON endpoint (called from
 * commands.js via fetch) rather than folding this into the create/update
 * forms: those stay plain application/x-www-form-urlencoded POSTs like every
 * other admin form in this dashboard, and multer's multipart parsing only
 * runs on this one route.
 *
 * @param req
 * @param res
 * @returns {Promise<void>}
 */
async function handleSynonymImageUpload(req, res) {
    if (denyNonManager(req, res)) return
    if (!req.file) return res.status(400).json({error: 'No image received'})

    // Re-anchor the temp file inside synonymUploadDir before touching the
    // filesystem: multer builds the name itself, but basename() keeps a path
    // that only ever points at our own upload directory. It is handed to
    // uploadImageFile(), which reads the file and never fetches a URL.
    const filePath = path.join(synonymUploadDir, path.basename(req.file.path))

    try {
        const url = await uploadImageFile(filePath)
        if (!url) return res.status(502).json({error: 'Upload failed'})

        // Refuse here rather than at save time. The bot can only deliver an
        // image from a host it is allowed to fetch, so an uploader answering
        // from anywhere else produces a URL that would be dropped when the
        // command is saved — after the thumbnail had already appeared and the
        // admin had no reason to think anything was wrong. The upload status
        // line in commands.js shows this message straight away.
        const safeUrl = safeImageUrl(url)
        if (!safeUrl) {
            console.error(
                'The image host answered from a host the bot may not fetch.',
                'Add it to IMAGE_ALLOWED_HOSTS. URL:',
                url)

            return res.status(502).json({
                error: 'Uploaded, but the bot cannot deliver images from that host. '
                    + 'Add it to IMAGE_ALLOWED_HOSTS.',
            })
        }

        res.json({url: safeUrl})
    } finally {
        await fs.promises.unlink(filePath).catch(() => {})
    }
}

async function handleSynonymCreate(req, res) {
    if (!req.session.user || !req.session.user.isManager) {
        return res.status(403).send('Not permitted')
    }

    const key = sanitizeText(req.body.key, 100).toLowerCase()
    if (!key || !checkSynonymKey(key) || await getSynonym(key)) {
        return redirectBackToCommands(req, res)
    }

    const value = buildSynonymValue({
        contentType: req.body.contentType,
        text: req.body.text,
        redirectTarget: req.body.redirectTarget,
        files: resolveNewSynonymFiles(req),
    })
    if (!value) return redirectBackToCommands(req, res)

    await createSynonym(key, value)
    await invalidateSynonymCache(key)
    redirectBackToCommands(req, res)
}

async function handleSynonymUpdate(req, res) {
    if (!req.session.user || !req.session.user.isManager) {
        return res.status(403).send('Not permitted')
    }

    const key = sanitizeText(req.params.key, 100).toLowerCase()
    const existing = key && await getSynonym(key)
    if (!existing) return redirectBackToCommands(req, res)

    const keptFiles = resolveKeptSynonymFiles(req, parseSynonymValue(existing.value).files)
    const value = buildSynonymValue({
        contentType: req.body.contentType,
        text: req.body.text,
        redirectTarget: req.body.redirectTarget,
        files: [...keptFiles, ...resolveNewSynonymFiles(req)],
    })
    if (!value) return redirectBackToCommands(req, res)

    await updateSynonym(key, value)
    if (existing.value !== value) await invalidateSynonymCache(key)
    redirectBackToCommands(req, res)
}

async function handleSynonymDelete(req, res) {
    if (!req.session.user || !req.session.user.isManager) {
        return res.status(403).send('Not permitted')
    }

    const key = sanitizeText(req.params.key, 100).toLowerCase()
    if (key && await getSynonym(key)) {
        await deleteSynonym(key)
        await invalidateSynonymCache(key)
    }
    redirectBackToCommands(req, res)
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

function sanitizePage(page) {
    return Number.isInteger(parseInt(page, 10)) && parseInt(page, 10) > 0
        ? parseInt(page, 10)
        : 1
}

function sanitizeText(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function sanitizeUserRole(value) {
    const role = sanitizeText(value, 20).toUpperCase()
    return ROLE_OPTIONS.some(option => option.value === role) ? role : ROLE.STANDARD
}

function sanitizeUserRoleFilter(value) {
    value = sanitizeText(value, 20)
    if (value === '__empty') return ROLE.STANDARD
    value = value.toUpperCase()
    return ROLE_OPTIONS.some(option => option.value === value) ? value : ''
}

function sanitizeUserStatus(value) {
    value = sanitizeText(value, 20).toLowerCase()
    return ['active', 'inactive', 'pending', 'declined'].includes(value) ? value : 'inactive'
}

// 'new' is a filter-only pseudo-status (users who registered today), not a
// value a user can actually be set to — hence it is here but not in
// sanitizeUserStatus above.
function sanitizeUserStatusFilter(value) {
    value = sanitizeText(value, 20).toLowerCase()
    return ['active', 'inactive', 'pending', 'declined', 'new'].includes(value) ? value : ''
}

async function invalidateUserEntityCache(discordId) {
    if (!discordId) return
    await redis.del(cacheKeyPrefix + 'user:' + discordId)
}

function canEditUserField(actor, target, field) {
    if (!actor || !actor.isManager || !target) return false
    const targetIsAdmin = isManager(target)
    const isOwnAdmin = targetIsAdmin && actor.id === target.discordId
    if (isOwnAdmin) return field === 'mode'
    if (field === 'role') return assignableRoleOptions(actor, target).length > 0
    if (targetIsAdmin) return false
    return ['mode', 'status'].includes(field)
}

/**
 * Same as redirectBackToCommands, for the user list's filters.
 *
 * @param req
 * @param res
 */
function redirectBackToUsers(req, res) {
    const query = parseReturnToQuery(req, '/users')

    return redirectToList(res, '/users', [
        ['username', sanitizeText(query.get('username'), 40)],
        ['discordId', sanitizeText(query.get('discordId'), 32)],
        ['role', sanitizeUserRoleFilter(query.get('role'))],
        ['status', sanitizeUserStatusFilter(query.get('status'))],
        ['mode', sanitizeText(query.get('mode'), 100)],
        ['page', query.has('page') ? sanitizePage(query.get('page')) : ''],
    ])
}

function buildRoleInfoCards(rules) {
    return EDITABLE_RULE_ROLES.map(role => {
        const option = ROLE_OPTIONS.find(option => option.value === role)
        const roleRules = rules[role]
        return {
            role,
            label: roleLabel(role),
            description: option.description,
            rules: roleRules,
            stats: [
                {label: 'Daily commands', value: roleRules.dailyCommandLimit || 'Unlimited'},
                {label: 'Commands/hour', value: roleRules.hourlyCommandLimit || 'Unlimited'},
                {label: 'Deck screenshots/day', value: roleRules.dailyDeckScreenshotLimit || 'Unlimited'},
                {label: 'Attachment limit', value: roleRules.attachmentLimit || 'Unlimited'},
            ],
        }
    })
}

// Human-readable timestamp for an audit-log row.
function formatAuditTimestamp(date) {
    return new Intl.DateTimeFormat('en-GB', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        timeZoneName: 'short',
    }).format(new Date(date))
}

// Shape the recent status/role changes for the users page's change log. `self`
// marks a user-initiated change (a Terms of Service accept/decline); anything
// else is the admin username who made the change.
function buildUserAuditRows(audits) {
    return audits.map(entry => ({
        id: entry.id,
        timestamp: formatAuditTimestamp(entry.createdAt),
        userId: entry.user ? entry.user.id : null,
        userName: (entry.user && entry.user.name) || 'Unknown',
        field: entry.field,
        oldValue: entry.oldValue || '—',
        newValue: entry.newValue || '—',
        actor: entry.actor === 'self' ? 'User (self)' : entry.actor,
        isSelf: entry.actor === 'self',
    }))
}

async function renderUsers(req, res) {
    let { page = '1', username, discordId, role, status, mode } = req.query

    const pageNumber = sanitizePage(page)
    const pageSize = 50
    username = sanitizeText(username, 40)
    discordId = sanitizeText(discordId, 32)
    role = sanitizeUserRoleFilter(role)
    status = sanitizeUserStatusFilter(status)
    mode = sanitizeText(mode, 100)

    // These all share user.js's Prisma client (each disconnects when it
    // settles), so they run one after another rather than in parallel — a
    // disconnect from one must not tear down another's in-flight query.
    const { users, totalCount } = await getUsers({
        page: pageNumber,
        pageSize,
        username,
        discordId,
        role,
        status,
        mode,
    })
    const statusCounts = await getUserStatusCounts()
    const auditRows = buildUserAuditRows(await getRecentUserAudits(20))
    const totalPages = Math.max(1, Math.ceil((totalCount || 0) / pageSize))
    const showRoleInfo = req.session.user && req.session.user.isManager
    const roleInfoCards = showRoleInfo ? buildRoleInfoCards(await getRoleRules()) : []

    res.render('users', {
        title: 'Users',
        statusCounts,
        auditRows,
        users: users.map(target => ({
            ...target,
            isAdmin: isManager(target),
            roleValue: normalizeRole(target.role),
            roleLabel: roleLabel(target.role),
            assignableRoles: assignableRoleOptions(req.session.user, target),
            canEditMode: canEditUserField(req.session.user, target, 'mode'),
            canEditRole: canEditUserField(req.session.user, target, 'role'),
            canEditStatus: canEditUserField(req.session.user, target, 'status'),
            commandsCount: target._count?.messages || 0,
        })),
        user: req.session.user,
        page: pageNumber,
        pageSize,
        totalPages,
        totalCount,
        username,
        discordId,
        role,
        status,
        mode,
        roleOptions: ROLE_OPTIONS,
        showRoleInfo,
        roleInfoCards,
    })
}

async function renderRoles(req, res) {
    const rules = await getRoleRules()
    res.render('roles', {
        title: 'Role Rules',
        user: req.session.user,
        roles: buildRoleInfoCards(rules),
    })
}

async function handleRoleRulesUpdate(req, res) {
    if (!isGod(req.session.user)) {
        return res.status(403).send('Not permitted')
    }

    const bodyRules = {}
    for (const role of EDITABLE_RULE_ROLES) {
        bodyRules[role] = {
            dailyCommandLimit: req.body[`${role}_dailyCommandLimit`],
            hourlyCommandLimit: req.body[`${role}_hourlyCommandLimit`],
            dailyDeckScreenshotLimit: req.body[`${role}_dailyDeckScreenshotLimit`],
            attachmentLimit: req.body[`${role}_attachmentLimit`],
        }
    }

    await saveRoleRules(normalizeRuleSet(bodyRules))
    res.redirect('/roles')
}

async function renderSystem(req, res) {
    const systemData = await buildSystemPageData(redis)

    res.render('system', {
        title: 'System',
        user: req.session.user,
        sync: await getSyncView(),
        ...systemData,
    })
}

/**
 * The sync widget's data, ready to print — the same object the page is
 * rendered from and the poll loop receives, so both draw it identically.
 *
 * @returns {Promise<object>}
 */
async function getSyncView() {
    return buildSyncView(await getSyncState(redis))
}

/**
 * Kick off a kards.com DB sync from the system page. Returns as soon as the
 * child process is spawned — the widget polls handleSyncStatus for the outcome.
 *
 * @param req
 * @param res
 * @returns {Promise<void>}
 */
async function handleSyncStart(req, res) {
    if (denyNonManager(req, res)) return

    const {started, reason} = startSync({triggeredBy: req.session.user.username || 'web'})
    if (!started) return res.status(409).json({error: reason})

    res.json(await getSyncView())
}

/**
 * Current sync state for the system page widget's poll loop.
 *
 * @param req
 * @param res
 * @returns {Promise<void>}
 */
async function handleSyncStatus(req, res) {
    if (denyNonManager(req, res)) return

    res.json(await getSyncView())
}

async function handleSystemSettingsUpdate(req, res) {
    if (!req.session.user || !isGod(req.session.user)) {
        return res.status(403).send('Not permitted')
    }

    await saveMemoryThresholdMb(req.body.memoryThresholdMb, redis)
    await saveNodeMemoryAvailableMb(req.body.memoryAvailableMb, redis)
    await saveRedisMemoryAvailableMb(req.body.redisMemoryAvailableMb, redis)
    res.redirect('/system')
}

async function renderTopDeck(req, res) {
    const cacheKey = webCachePrefix + 'page:topdeck'
    let pageData = await redis.json.get(cacheKey, '$')

    if (!pageData) {
        const ranking = await getTopDeckRanking(100) || []
        const totals = ranking.reduce((sum, player) => ({
            wins: sum.wins + player.tdWins,
            loses: sum.loses + player.tdLoses,
            draws: sum.draws + player.tdDraws,
            games: sum.games + player.tdGames,
        }), { wins: 0, loses: 0, draws: 0, games: 0 })
        const totalOutcomes = totals.wins + totals.loses + totals.draws
        const outcomePercent = count => totalOutcomes ? Number(((count / totalOutcomes) * 100).toFixed(1)) : 0

        pageData = {
            ranking,
            totals,
            chartData: {
                topScores: ranking.slice(0, 10).map(player => ({
                    name: player.name,
                    score: player.score,
                    wins: player.tdWins,
                    loses: player.tdLoses,
                    draws: player.tdDraws,
                })),
                outcomes: [
                    { label: 'Wins', count: totals.wins, percent: outcomePercent(totals.wins) },
                    { label: 'Loses', count: totals.loses, percent: outcomePercent(totals.loses) },
                    { label: 'Draws', count: totals.draws, percent: outcomePercent(totals.draws) },
                ],
                activity: ranking.slice(0, 20).map(player => ({
                    name: player.name,
                    games: player.tdGames,
                    winRatio: Number(player.winRatio),
                })),
            },
        }

        await redis.json.set(cacheKey, '$', pageData)
        await redis.expire(cacheKey, topDeckPageExpiration)
    }

    res.set('Cache-Control', `public, max-age=${topDeckPageExpiration}`)
    res.render('topdeck', {
        title: 'Top Deck Ranking',
        user: req.session ? req.session.user : null,
        ...pageData,
    })
}

async function handleUserUpdate(req, res) {
    if (!req.session.user || !req.session.user.isManager) {
        return res.status(403).send('Not permitted')
    }

    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id <= 0) {
        return redirectBackToUsers(req, res)
    }

    const target = await getUserById(id)
    if (!target) return redirectBackToUsers(req, res)

    const field = sanitizeText(req.body.field, 20)
    if (!canEditUserField(req.session.user, target, field)) {
        return redirectBackToUsers(req, res)
    }

    const data = {}
    // Only role/status changes are audited (mode is a free-text reply, not a
    // status/role change); null when nothing auditable actually changed.
    let audit = null
    if (field === 'mode') data.mode = sanitizeText(req.body.mode, 500) || null
    else if (field === 'role') {
        const role = sanitizeUserRole(req.body.role)
        if (!canAssignRole(req.session.user, target, role)) {
            return redirectBackToUsers(req, res)
        }
        data.role = roleToDbValue(role)
        const oldLabel = roleLabel(target.role)
        const newLabel = roleLabel(role)
        if (oldLabel !== newLabel) {
            audit = { field: 'role', oldValue: oldLabel, newValue: newLabel }
        }
    }
    else if (field === 'status') {
        data.status = sanitizeUserStatus(req.body.status)
        if (target.status !== data.status) {
            audit = { field: 'status', oldValue: target.status, newValue: data.status }
        }
    }
    else return redirectBackToUsers(req, res)

    await updateUserAdminFields(id, data)
    if (audit) {
        await createUserAudit({
            userId: id,
            field: audit.field,
            oldValue: audit.oldValue,
            newValue: audit.newValue,
            actor: req.session.user.username || 'admin',
        })
    }
    await invalidateUserEntityCache(target.discordId)
    redirectBackToUsers(req, res)
}

async function handleUserStatusToggle(req, res) {
    if (!req.session.user || !req.session.user.isManager) {
        return res.status(403).send('Not permitted')
    }

    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id <= 0) {
        return redirectBackToUsers(req, res)
    }

    const target = await getUserById(id)
    if (!target) return redirectBackToUsers(req, res)
    if (!canEditUserField(req.session.user, target, 'status')) {
        return redirectBackToUsers(req, res)
    }

    const nextStatus = target.status === 'active' ? 'inactive' : 'active'
    await updateUserAdminFields(id, { status: nextStatus })
    if (target.status !== nextStatus) {
        await createUserAudit({
            userId: id,
            field: 'status',
            oldValue: target.status,
            newValue: nextStatus,
            actor: req.session.user.username || 'admin',
        })
    }
    await invalidateUserEntityCache(target.discordId)
    redirectBackToUsers(req, res)
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
    const [messages, stats] = await Promise.all([
        getUserMessages(dbUserId),
        getProfileStats(dbUserId),
    ])

    renderProfileView(req, res, {
        displayName: req.session.user.username,
        avatarUrl: sessionAvatarUrl(req.session.user),
        stats,
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

    if (req.session.user && req.session.user.role === undefined) {
        await refreshSessionUser(req)
    }

    if (!req.session.user || !req.session.user.isManager) {
        return res.status(403).send('Not permitted')
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

// Legal pages required for Discord application verification. Public and static —
// the "Last updated" date bumps on deployment, so the pages always reflect their
// current content.
const LEGAL_EFFECTIVE_DATE = 'July 19, 2026'

function renderTerms(req, res) {
    res.render('terms', {
        title: 'Terms of Service',
        user: req.session ? req.session.user : null,
        effectiveDate: LEGAL_EFFECTIVE_DATE,
    })
}

function renderPrivacy(req, res) {
    res.render('privacy', {
        title: 'Privacy Policy',
        user: req.session ? req.session.user : null,
        effectiveDate: LEGAL_EFFECTIVE_DATE,
    })
}

async function handleApi(req, res) {
    const { method } = req.params
    const period = resolveStatsPeriod(req)

    if (method === 'top-users') {
        const user = req.session ? req.session.user : null
        if (!user || !user.isManager) {
            return res.status(403).json({
                result: 403,
                success: false,
                message: 'Forbidden',
                data: []
            })
        }
    }

    const apiResponse = await API.run(method, { period })

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
    requireGod,
    renderAuth,
    startDiscordAuth,
    renderDashboard,
    renderMessages,
    renderUsers,
    renderRoles,
    renderSystem,
    renderTopDeck,
    renderCommands,
    renderServers,
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
    handleSyncStart,
    handleSyncStatus,
    handleUserStatusToggle,
    handleLogout,
    handleLogin,
    synonymImageUpload,
    handleSynonymImageUpload,
    handleSynonymCreate,
    handleSynonymUpdate,
    handleSynonymDelete,
    buildSynonymValue,
    parseSynonymValue,
}
