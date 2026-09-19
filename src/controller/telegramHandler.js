const {getLanguageByInput, deckBuilderLanguages, languages} = require("../tools/language")
const {getStats} = require("../tools/stats")
const bot = require("./bot")
const {getUser, updateUser, getSynonym, createMessage, getProfileStats, createUserAudit} = require("../database/db")
const {translate} = require("../tools/translation/translator")
const {getCards, getFiles} = require("../tools/search")
const {getMediaGroup, Input, Markup} = require("../clients/telegram")
const {renderProfileText, reactionsLabel} = require("../tools/profile")
const globalLimit = parseInt(process.env.LIMIT) || 10 //attachment limit
const minStrLen = parseInt(process.env.MIN_STR_LEN) || 2
const maxStrLen = 256 // buffer overflow protection :)
const maxFileSize = 5*1024*1024 //5MB
const defaultPrefix = process.env.DEFAULT_PREFIX || '!'
const {getDeckFiles, deleteDeckFiles} = require("../tools/fileManager")
const {takeScreenshot} = require("../tools/puppeteer")
const cacheKeyPrefix = process.env.NODE_ENV === 'production' ? '' : 'dev:'
const {downloadImageAsFile, convertImageToWEBP} = require("../tools/imageUpload")
const {analyseDeck} = require("../tools/deck")
const fs = require('fs').promises
const path = require('path')
const {
    checkRoleCommandLimit,
    checkRoleDeckScreenshotLimit,
} = require("../tools/roles")
const {telegramActor, logCommand, setLog, addTiming} = require("../tools/commandLog")
const {
    recordEmptySearch,
    clearEmptySearches,
    searchHelp,
} = require("../tools/failureStreak")

//Telegram only allows a fixed set of reaction emojis, so these are the
//closest equivalents for each outcome. Reactions are Telegram-only: Discord
//took the Message Content intent away, so the bot no longer reacts there.
const reactions = {
    success: '👍',      //an answer was delivered
    noResult: '🤔',     //nothing was found
    blocked: '😡',      //a blocked user tried a command
    moreResults: '👀',  //more results exist than were shown
    wait: '🙏',         //a render is already running, please wait
    error: '🤯',        //something went wrong
}

const telegramCachePrefix = 'telegram:card:'
const telegramSearchPrefix = 'telegram:search:'
//how long a whole search answer stays replayable; matches the Discord search
//cache and the file_id cache the replay depends on
const searchExp = process.env.REDIS_EXP_SEARCH || 60 * 60 * 24 * 90 //90 days

/**
 * React to the user's command message, ignoring failures (some chats
 * disallow reactions). Fire-and-forget: nothing waits on the emoji.
 *
 * @param tgCtx
 * @param emoji
 * @param user the acting user; skipped when they opted out of reactions
 * @returns {void}
 */
function react(tgCtx, emoji, user)
{
    if (user && user.reactions === false) return

    tgCtx.react(emoji).catch(err =>
        console.error('Failed to react:', err.message))
}

/**
 * Resolve the incoming text into a clean command, or signal a stop.
 *
 * @param tgCtx
 * @returns {{command?: string, stop?: boolean}}
 */
function resolveCommandText(tgCtx)
{
    const text = tgCtx.update.message.text
    if (!text.startsWith(defaultPrefix) ||
        tgCtx.update.message.from.is_bot ||
        text.length > maxStrLen) return {stop: true}

    return {command: bot.parseCommand(defaultPrefix, text)}
}

/**
 * Load the user (or null when there is no usable sender id).
 *
 * @param tgCtx
 * @returns {Promise<*|null>}
 */
async function loadUser(tgCtx)
{
    const userId = tgCtx.update?.message?.from?.id?.toString() || null
    if (!userId) return null

    return getUser(userId)
}

/**
 * Auto-activate a new Telegram user. Every user row is created as 'pending'
 * for the Discord Terms-of-Service gate, but Telegram has no terms flow, so
 * pending Telegram users are activated on any interaction (text command or
 * button tap). Only touches 'pending' users, so admin-set statuses
 * (inactive/declined) are left alone.
 *
 * @param user the loaded user, mutated in place when activated
 * @returns {Promise<void>}
 */
async function activatePendingUser(user)
{
    if (user.status !== 'pending') return

    user.status = 'active'
    await updateUser(user)
    //record the change in the users-page log, the same way the Discord Terms
    //flow does, so an auto-activation shows up as 'pending -> active' instead
    //of leaving a bare 'registered -> pending' entry that looks stuck.
    await createUserAudit({
        userId: user.id,
        field: 'status',
        oldValue: 'pending',
        newValue: 'active',
        actor: 'self',
    })
}

/**
 * React and bail for blocked users.
 *
 * @param ctx
 * @returns {boolean} true when the user is blocked (stop processing)
 */
function checkUserStatus(ctx)
{
    const {tgCtx, user} = ctx
    if (user.status !== 'active') {
        react(tgCtx, reactions.blocked)
        if (user.mode) tgCtx.reply(user.mode)
        setLog(ctx, {result: 'user ' + user.status})
        logCommand('blocked', ctx, telegramActor(ctx))

        return true
    }

    return false
}

/**
 * Switch the user's language.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleLanguageSwitch(ctx)
{
    const {tgCtx, user, command} = ctx
    if (!bot.isLanguageSwitch(command)) return false

    const language = await bot.switchLanguage(user, command)
    await tgCtx.reply(translate(language, 'langChange') + language.toUpperCase())

    return true
}

/**
 * Persist the username on first contact and resolve the language to use
 * (switch to RU when cyrillic is detected, else use the stored language).
 *
 * @param ctx
 * @returns {Promise<void>}
 */
async function persistUser(ctx)
{
    const {tgCtx, user} = ctx
    if (!user.name) user.name = tgCtx.update.message.from.first_name
    //change user language to RU if cyrillic is detected
    if (ctx.language === 'ru') user.language = 'ru'
    else ctx.language = user.language
    await updateUser(user)
}

/**
 * Reply with the online/in-game stats (double prefix).
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleStats(ctx)
{
    const {tgCtx, rawText, language} = ctx
    if (rawText !== defaultPrefix + defaultPrefix) return false

    await tgCtx.reply(await getStats(language))

    return true
}

/**
 * Reply with the help text.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleHelp(ctx)
{
    if (ctx.command !== 'help') return false

    await ctx.tgCtx.reply(translate(ctx.language, 'help'))

    return true
}

/**
 * Render a deck link / deck code as card images.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleDeck(ctx)
{
    const {tgCtx, redis, language, user} = ctx
    if (!bot.isDeckLink(ctx.command) && !bot.isDeckCode(ctx.command))
        return false

    //command is lowercased, but we need the original deck code
    const command = bot.getDeckCode(tgCtx.update.message.text)
    //check if the deck is already in the cache
    const deckKey = cacheKeyPrefix + 'deck:' + language + ':' + command
    const deckCacheStarted = Date.now()
    if (await redis.exists(deckKey)) {
        const response = await redis.json.get(deckKey, '$')
        addTiming(ctx, 'cache', Date.now() - deckCacheStarted)
        react(tgCtx, reactions.success, user)
        await tgCtx.replyWithPhoto(response.files[0])
        await tgCtx.reply(response.content.replaceAll('```', ''))
        await tgCtx.replyWithPhoto(response.files[1])
        setLog(ctx, {q: command, cache: 'HIT'})

        return true
    }

    addTiming(ctx, 'cache', Date.now() - deckCacheStarted)

    const deckLimit = await checkRoleDeckScreenshotLimit(ctx)
    if (!deckLimit.allowed) {
        await tgCtx.reply(deckLimit.message)
        setLog(ctx, {q: command, cache: 'MISS', result: 'limit reached'})

        return true
    }

    const deckInfo = await analyseDeck(command, language)
    if (!deckInfo) {
        await tgCtx.reply(translate(language, 'error'))
        setLog(ctx, {q: command, cache: 'MISS', result: 'unreadable deck code'})

        return true
    }

    let deckBuilderLang = ''
    if (deckBuilderLanguages.includes(language)) deckBuilderLang = language + '/'
    const deckBuilderURL =
        'https://www.kards.com/' + deckBuilderLang + 'decks/deck-builder?hash='

    const hash = encodeURIComponent(command)
    const url = bot.isDeckLink(bot.parseCommand(defaultPrefix, command))
        ? bot.parseCommand(defaultPrefix, command)
        : deckBuilderURL + hash

    //send the message that screenshot is running and store ID
    const runningMsg = await tgCtx.reply(translate(language, 'screenshot'))
    const runningMsgId = runningMsg.message_id

    let filename
    try {
        const shotStarted = Date.now()
        filename = await takeScreenshot(url)
        const shotMs = Date.now() - shotStarted

        if (filename) {
            const files = getDeckFiles(filename)
            react(tgCtx, reactions.success, user)
            await tgCtx.replyWithPhoto({source: files[0]})
            await tgCtx.reply(deckInfo.replaceAll('```', ''))
            await tgCtx.replyWithPhoto({source: files[1]})
        } else {
            await tgCtx.reply(translate(language, 'error'))
        }
        addTiming(ctx, 'shot', shotMs)
        setLog(ctx, {q: command, cache: 'MISS',
            result: filename ? 'sent' : 'render failed'})
    } finally {
        //delete the "screenshot running" message from the chat
        try {
            await tgCtx.deleteMessage(runningMsgId)
        } catch (err) {
            console.error('Failed to delete status message:', err)
        }

        if (filename) deleteDeckFiles(filename)
    }

    return true
}

/**
 * Reply with one or more custom-command images. A single file is sent as
 * a photo (or animation for GIFs); several files are sent as one media
 * group, mirroring Discord's multi-attachment answers.
 *
 * @param tgCtx
 * @param files array of remote image URLs
 * @returns {Promise<*>}
 */
async function replySynonymFiles(tgCtx, files)
{
    if (files.length === 1) {
        const url = files[0]
        //we need a different method for GIF images
        if (url.endsWith('.gif')) return tgCtx.replyWithAnimation(url)

        return tgCtx.replyWithPhoto(url)
    }

    //multiple images -> a single media group (Telegram accepts remote URLs)
    const mediaGroup = files.map(media => ({type: 'photo', media}))

    return tgCtx.replyWithMediaGroup(mediaGroup)
}

/**
 * Reply with a single custom-command image link, after a size check.
 *
 * @param ctx
 * @param url
 * @returns {Promise<boolean>}
 */
async function replySynonymImage(ctx, url)
{
    const {tgCtx, language, user} = ctx
    try {
        const fileSize = await bot.getFileSize(url)
        if (!fileSize || fileSize >= maxFileSize) {
            await tgCtx.reply(translate(language, 'error'))

            return true
        }
        react(tgCtx, reactions.success, user)
        await replySynonymFiles(tgCtx, [url])
    } catch (e) {
        console.log(e)
        await tgCtx.reply(translate(language, 'error'))
    }

    return true
}

/**
 * Resolve a synonym: either reply (stop) or rewrite ctx.command for search.
 *
 * @param ctx
 * @returns {Promise<boolean>} true when the command was fully handled
 */
async function resolveSynonym(ctx)
{
    const {tgCtx, language, user} = ctx
    const syn = await getSynonym(ctx.command)
    if (!syn) return false

    let value = syn.value
    //JSON-format synonym
    if (value.startsWith('{')) {
        const m = JSON.parse(value)
        //send every image when a custom command returns more than one
        if (m.files && m.files.length) {
            try {
                react(tgCtx, reactions.success, user)
                await replySynonymFiles(tgCtx, m.files)
            } catch (e) {
                console.log(e)
                await tgCtx.reply(translate(language, 'error'))
            }

            return true
        }
        if (m.content) value = m.content
    }

    //a remote image / gif link
    if (value.startsWith('https')) return replySynonymImage(ctx, value)

    //a plain text reply
    if (value.startsWith('text:')) {
        react(tgCtx, reactions.success, user)
        await tgCtx.reply(value.replace('text:', '').replaceAll('```', ''))

        return true
    }

    //else use the value as the command for a card search
    ctx.command = value

    return false
}

/**
 * Download and convert the found card images for Telegram, reusing cached
 * Telegram file_ids and on-disk webp conversions where possible.
 *
 * @param ctx
 * @param files mutated in place with the upload-ready attachment
 * @param downloadedFiles collects temp files to clean up afterwards
 * @returns {Promise<boolean>} false when a conversion failed (error replied)
 */
async function convertFilesForTelegram(ctx, files, downloadedFiles)
{
    const {tgCtx, redis, language} = ctx
    for (const file of files) {
        try {
            const cacheKey = cacheKeyPrefix + telegramCachePrefix + file.attachment

            //check if a Telegram file_id is already cached
            const cachedFileId = await redis.get(cacheKey)
            if (cachedFileId) {
                file.attachment = cachedFileId
                file.isTelegramFileId = true
                continue
            }

            //build the expected webp path based on URL
            const fileName = path.basename(file.attachment.split('?')[0])
            const languageFileName = language + '_' + fileName
            const expectedWebpPath = path.join(
                __dirname,
                '../tmp/downloads',
                `${path.parse(languageFileName).name}.webp`
            )

            let webpExists = false
            try {
                const stats = await fs.stat(expectedWebpPath)
                webpExists = stats.isFile() && stats.size > 0
            } catch (err) {
                // File doesn't exist
            }
            //keep the original attachment URL for later use
            file.originalAttachmentUrl = file.attachment

            if (webpExists) {
                file.attachment = expectedWebpPath
            } else {
                const downloadedPath =
                    await downloadImageAsFile(file.attachment, language)
                downloadedFiles.push(downloadedPath)
                file.attachment = await convertImageToWEBP(downloadedPath)
            }
        } catch (e) {
            console.error(e)
            await tgCtx.reply(translate(language, 'error'))

            return false
        }
    }

    return true
}

/**
 * Cache the Telegram file_id of every newly uploaded photo so the next
 * request can be served without re-uploading.
 *
 * @param redis
 * @param files
 * @param sentMessages parallel array of sent messages (one per file)
 * @returns {Promise<void>}
 */
async function cacheSentPhotos(redis, files, sentMessages)
{
    for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (file.isTelegramFileId) continue

        const sentMessage = sentMessages[i]
        if (!sentMessage?.photo?.length) continue

        const largestPhoto = sentMessage.photo[sentMessage.photo.length - 1]
        const cacheKey =
            cacheKeyPrefix + telegramCachePrefix + file.originalAttachmentUrl

        await redis.set(cacheKey, largestPhoto.file_id)
        await redis.expire(cacheKey,
            process.env.REDIS_EXP_TELEGRAM || 60 * 60 * 24 * 90) // 90 days
    }
}

/**
 * The Telegram file_id of every photo just sent. This is what makes a search
 * replayable: the whole answer can be re-sent by id, with no DB query, no
 * download and no upload.
 *
 * The ids are read back off the sent messages rather than off the files,
 * because Telegram answers every successful photo send with the photo it
 * stored - including one sent by id. A send that failed replies with plain
 * text instead, which has no photo, so a failed or partial answer is rejected
 * here and never cached.
 *
 * @param files
 * @param sentMessages parallel array of sent messages (one per file)
 * @returns {Array|false} false unless every image came back confirmed
 */
function collectFileIds(files, sentMessages)
{
    if (!files.length || sentMessages?.length !== files.length) return false

    const collected = []
    for (let i = 0; i < files.length; i++) {
        const photo = sentMessages[i]?.photo
        if (!photo?.length) return false

        collected.push({
            fileId: photo[photo.length - 1].file_id,
            caption: files[i].description || '',
        })
    }

    return collected
}

/**
 * The key a search answer is cached under. The attachment limit is part of it
 * because it decides how many cards the answer holds, and it differs between
 * private chats and groups.
 *
 * @param ctx
 * @returns {string}
 */
function searchCacheKey(ctx)
{
    return cacheKeyPrefix + telegramSearchPrefix +
        ctx.language + ':' + ctx.command + ':' + ctx.limit
}

/**
 * Replay a previously cached search answer, skipping the DB lookup and both
 * the download and the upload of every image.
 *
 * A file_id can go stale before the key expires, so a failed replay drops the
 * key and reports a miss, letting the caller rebuild the answer from scratch
 * rather than leaving the query broken until the cache expires.
 *
 * @param ctx
 * @param cacheKey
 * @returns {Promise<boolean>} true when the answer was served from cache
 */
async function serveSearchCache(ctx, cacheKey)
{
    const {tgCtx, redis, language, limit, user} = ctx

    //recorded even on a miss: the probe is paid for either way, and a miss
    //that quietly costs a round trip makes the fallback look cheaper than it is
    const cacheStarted = Date.now()
    const cached = await redis.json.get(cacheKey, '$')
    addTiming(ctx, 'cache', Date.now() - cacheStarted)
    if (!cached || !cached.files?.length) return false

    const sendStarted = Date.now()
    try {
        react(tgCtx, cached.counter > limit
            ? reactions.moreResults
            : reactions.success, user)
        await tgCtx.reply(translate(language, 'search') + ': ' + cached.counter)

        if (cached.files.length > 1) {
            await tgCtx.replyWithMediaGroup(cached.files.map(file => ({
                type: 'photo', media: file.fileId, caption: file.caption,
            })))
        } else {
            await tgCtx.replyWithPhoto(cached.files[0].fileId,
                {caption: cached.files[0].caption})
        }
    } catch (e) {
        //most likely an expired file_id - drop the answer and search again
        console.error('cached search replay failed:', e.message)
        await redis.del(cacheKey)

        return false
    }
    addTiming(ctx, 'send', Date.now() - sendStarted)

    setLog(ctx, {cache: 'HIT', result: cached.counter + ' found'})

    return true
}

/**
 * Send several found cards as a media group, caching new uploads.
 *
 * @param ctx
 * @param files
 * @returns {Promise<*>}
 */
async function sendCardMediaGroup(ctx, files)
{
    const {tgCtx, redis, language} = ctx
    try {
        const sentMessages = await tgCtx.replyWithMediaGroup(getMediaGroup(files))
        await cacheSentPhotos(redis, files, sentMessages)

        return sentMessages
    } catch (e) {
        console.log(e)

        return tgCtx.reply(translate(language, 'error'))
    }
}

/**
 * Send a single found card, caching the new upload.
 *
 * @param ctx
 * @param file
 * @returns {Promise<*>}
 */
async function sendCardPhoto(ctx, file)
{
    const {tgCtx, redis, language} = ctx
    try {
        //already uploaded before -> send by file_id
        if (file.isTelegramFileId) {
            //the file_id is a ~100-char opaque token; a short prefix is enough
            //to tell "served a cached upload" apart in the logs
            console.log('sending image by cached file_id:',
                String(file.attachment).slice(0, 12) + '…')

            return tgCtx.replyWithPhoto(file.attachment, {
                caption: file.description,
            })
        }

        //upload a new image
        const sentMessage = await tgCtx.replyWithPhoto(
            Input.fromLocalFile(file.attachment),
            {caption: file.description}
        )
        await cacheSentPhotos(redis, [file], [sentMessage])

        return sentMessage
    } catch (e) {
        console.log(e)

        return tgCtx.reply(translate(language, 'error'))
    }
}

/**
 * Search KARDS.com and reply with the cards.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleSearch(ctx)
{
    const {tgCtx, redis, language, command, limit, user} = ctx
    //a repeat query is replayed from cache: no DB lookup, no upload
    const cacheKey = searchCacheKey(ctx)
    if (await serveSearchCache(ctx, cacheKey)) {
        await clearEmptySearches(redis, user)

        return true
    }

    const variables = {
        language: language,
        q: command,
        showSpawnables: true,
        showReserved: true,
    }
    if (!ctx.timings) ctx.timings = {}
    const cards = await getCards(variables, 3000, ctx.timings)
    setLog(ctx, {cache: 'MISS'})
    if (!cards) {
        setLog(ctx, {result: 'lookup failed'})

        return true
    }
    if (!cards.counter) {
        let reply = translate(language, 'noresult')
        //three empty searches in a row -> show how the search works. Telegram
        //has no ephemeral message, so this lands in the chat like any reply.
        const helped = await recordEmptySearch(redis, user)
        if (helped) reply += '\n\n' + searchHelp(language)
        react(tgCtx, reactions.noResult, user)
        await tgCtx.reply(reply)
        setLog(ctx, {result: '0 found' + (helped ? ' (help shown)' : '')})

        return true
    }

    await clearEmptySearches(redis, user)

    //react before the slow download/convert step so the emoji appears
    //immediately, not after the images have been fetched and converted.
    //flag when more cards exist than fit within the limit
    react(tgCtx, cards.counter > limit
        ? reactions.moreResults
        : reactions.success, user)

    const files = getFiles(cards, language, limit)
    await tgCtx.reply(translate(language, 'search') + ': ' + cards.counter)

    const downloadedFiles = []
    try {
        //the download and webp conversion of every image: on a miss this is
        //what the cache actually saves, and it dwarfs the DB lookup
        const convStarted = Date.now()
        const converted =
            await convertFilesForTelegram(ctx, files, downloadedFiles)
        addTiming(ctx, 'conv', Date.now() - convStarted)
        if (!converted) {
            //the optimistic success reaction no longer holds: the conversion
            //failed and an error reply was already sent, so correct the emoji.
            react(tgCtx, reactions.error, user)
            setLog(ctx, {result: cards.counter + ' found (convert failed)'})

            return true
        }

        const sendStarted = Date.now()
        const sent = cards.counter > 1
            ? await sendCardMediaGroup(ctx, files)
            : await sendCardPhoto(ctx, files[0])
        addTiming(ctx, 'send', Date.now() - sendStarted)
        setLog(ctx, {result: cards.counter + ' found'})

        //cache the answer so the next identical query replays it. A send that
        //failed returns the error reply instead of photos, and collectFileIds
        //rejects it, so a broken answer is never stored.
        const fileIds = collectFileIds(files,
            Array.isArray(sent) ? sent : [sent])
        if (fileIds) {
            await redis.json.set(cacheKey, '$',
                {counter: cards.counter, files: fileIds})
            await redis.expire(cacheKey, searchExp)
        }
    } finally {
        for (const filePath of downloadedFiles) {
            try {
                await fs.unlink(filePath)
            } catch (err) {
                console.error('Error cleaning up downloaded file:', err)
            }
        }
    }

    return true
}

/**
 * Reply with a button that reveals the user's stats privately on tap.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleProfile(ctx)
{
    const {tgCtx, language} = ctx
    if (ctx.command !== 'profile') return false

    await tgCtx.reply(
        translate(language, 'profilePrompt'),
        Markup.inlineKeyboard([[
            Markup.button.callback(
                translate(language, 'profileButton'), 'profile_show'),
        ]]))

    return true
}

/**
 * Build the profile overview: stats text, plus — only when settings are
 * allowed — a search-language picker (Telegram has no select, so a grid of
 * buttons) and a reactions opt-out toggle. The settings are shown in private
 * chats only; in groups the controls are hidden (and the message is public),
 * so just the stats are shown.
 *
 * @param user
 * @param includeSettings whether to attach the settings controls
 * @returns {Promise<{text: string, keyboard: *}>}
 */
async function buildProfileView(user, includeSettings)
{
    const stats = await getProfileStats(user.id)
    //Telegram has no embed author line, so the name goes in as the heading;
    //fall back to the generic title when the stored name is empty.
    const heading = user.name || translate(user.language, 'profileTitle')
    const text = renderProfileText(user.language, stats, heading)

    //no settings controls outside private chats -> stats only
    if (!includeSettings) return {text, keyboard: undefined}

    //language buttons, 4 per row, the current one marked with a check
    const langButtons = languages.map(lang => Markup.button.callback(
        (lang === user.language ? '✅ ' : '') + lang.toUpperCase(),
        'profile_lang:' + lang))
    const rows = []
    for (let i = 0; i < langButtons.length; i += 4) {
        rows.push(langButtons.slice(i, i + 4))
    }
    rows.push([Markup.button.callback(
        reactionsLabel(user.language, user), 'profile_reactions')])

    return {text, keyboard: Markup.inlineKeyboard(rows)}
}

/**
 * Run the handler chain and log the interaction on the handler that claims it.
 *
 * Mirrors the Discord dispatcher: every command ends on exactly one handler, so
 * the summary line is emitted here rather than inside each one. Handlers enrich
 * ctx.log via setLog() when they know more about the outcome.
 *
 * @param ctx
 * @param handlers [kind, handler] pairs, tried in order
 * @returns {Promise<boolean>} true when one of them handled the command
 */
async function dispatch(ctx, handlers)
{
    for (const [kind, handler] of handlers) {
        if (await handler(ctx)) {
            logCommand(kind, ctx, telegramActor(ctx))

            return true
        }
    }

    return false
}

/**
 * Handle the profile button / reactions-toggle callbacks. Not available for
 * blocked users.
 *
 * @param tgCtx
 * @returns {Promise<*>}
 */
async function telegramCallbackHandler(tgCtx)
{
    const data = tgCtx.callbackQuery?.data
    if (data !== 'profile_show' && data !== 'profile_reactions' &&
        !data?.startsWith('profile_lang:')) return

    const userId = tgCtx.callbackQuery?.from?.id?.toString() || null
    if (!userId) return
    const user = await getUser(userId)
    //Telegram has no Terms gate; activate a pending user on any interaction
    await activatePendingUser(user)

    //a button tap is an interaction like any other, so it gets the same log
    //line and the same messages-table row a typed command does
    const ctx = {
        tgCtx, user, command: data,
        chatName: tgCtx.chat?.title || 'private',
    }

    //this feature is not available for blocked users
    if (user.status !== 'active') {
        setLog(ctx, {result: 'user ' + user.status})
        logCommand('blocked', ctx, telegramActor(ctx))

        return tgCtx.answerCbQuery(
            translate(user.language, 'blocked'), {show_alert: true})
    }

    createMessage({authorId: user.id,
        content: `Telegram | ${ctx.chatName} | -> ${data}`}).then()

    //toggle the reactions opt-out flag and persist it
    if (data === 'profile_reactions') {
        user.reactions = user.reactions === false
        await updateUser(user)
    }

    //change the search language and persist it
    if (data.startsWith('profile_lang:')) {
        const language = data.split(':')[1]
        if (languages.includes(language)) {
            user.language = language
            await updateUser(user)
        }
    }

    //settings controls are private-chat only; groups get the stats alone
    const isPrivate = tgCtx.chat?.type === 'private'
    const {text, keyboard} = await buildProfileView(user, isPrivate)
    try {
        await tgCtx.editMessageText(text, keyboard)
        setLog(ctx, {result: 'shown'})
    } catch (e) {
        //the message may be unchanged or too old to edit; ignore
        setLog(ctx, {result: 'edit failed'})
        console.error('Failed to edit profile message:', e.message)
    }
    logCommand('profile', ctx, telegramActor(ctx))

    return tgCtx.answerCbQuery()
}

/**
 *
 * @param tgCtx
 * @param redis
 * @returns {Promise<*>}
 */
async function telegramHandler(tgCtx, redis)
{
    const text = resolveCommandText(tgCtx)
    if (text.stop) return

    const ctx = {
        tgCtx, redis,
        prefix: defaultPrefix,
        command: text.command,
        rawText: tgCtx.update.message.text,
        language: getLanguageByInput(tgCtx.update.message.text),
        user: undefined,
        //set the attachment limit to 10 if it is a private chat
        limit: tgCtx.update.message.chat.type === 'private' ? 10 : globalLimit,
        chatName: tgCtx.update?.message?.chat?.title || 'private',
    }

    //get or create the user
    ctx.user = await loadUser(tgCtx)
    if (!ctx.user) return
    //the Terms of Service accept flow is Discord-only; auto-activate new
    //(pending) Telegram users so their behavior is unchanged
    await activatePendingUser(ctx.user)
    if (checkUserStatus(ctx)) return

    //switch language
    if (await dispatch(ctx, [['lang', handleLanguageSwitch]])) return
    //update user and resolve the language to use
    await persistUser(ctx)

    const roleLimit = await checkRoleCommandLimit(ctx)
    if (!roleLimit.allowed) {
        if (!roleLimit.silent && roleLimit.message) {
            await tgCtx.reply(roleLimit.message)
        }
        setLog(ctx, {result: 'limit reached' + (roleLimit.silent ? ' (silent)' : '')})
        logCommand('limit', ctx, telegramActor(ctx))

        return
    }
    if (roleLimit.message) await tgCtx.reply(roleLimit.message)

    //save the message. Deck codes are trimmed to just the code so the whole
    //message is not stored.
    const storedCommand = bot.getLoggableCommand(
        ctx.command, tgCtx.update.message.text)
    const commandToSave = `Telegram | ${ctx.chatName} | -> ${storedCommand}`
    createMessage({authorId: ctx.user.id, content: commandToSave}).then()

    if (await dispatch(ctx, [
        ['stats', handleStats],
        ['help', handleHelp],
        ['profile', handleProfile],
    ])) return

    if (!ctx.command.length) return //do nothing if it's just the prefix
    if (ctx.command.length < minStrLen) {
        setLog(ctx, {result: 'too short'})
        logCommand('rejected', ctx, telegramActor(ctx))

        return tgCtx.reply(translate(ctx.language, 'min'))
    }

    await dispatch(ctx, [
        ['deck', handleDeck],
        //resolveSynonym may rewrite ctx.command and fall through to search
        ['custom', resolveSynonym],
        ['search', handleSearch],
    ])
}

module.exports = {telegramHandler, telegramCallbackHandler}
