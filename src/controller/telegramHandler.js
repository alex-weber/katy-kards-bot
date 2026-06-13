const {getLanguageByInput, deckBuilderLanguages} = require("../tools/language")
const {getStats} = require("../tools/stats")
const bot = require("./bot")
const {getUser, updateUser, getSynonym, createMessage} = require("../database/db")
const {translate} = require("../tools/translation/translator")
const {getCards, getFiles} = require("../tools/search")
const {getMediaGroup, Input} = require("../clients/telegram")
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

//Telegram only allows a fixed set of reaction emojis, so these are the
//closest equivalents to the Discord reactions used in discordHandler.
const reactions = {
    success: '👍',      //an answer was delivered (Discord: ✅)
    noResult: '🤔',     //nothing was found (Discord: ❓)
    blocked: '😡',      //a blocked user tried a command (Discord: 🚫)
    moreResults: '👀',  //more results exist than were shown (Discord: 👆)
    wait: '🙏',         //a render is already running, please wait (Discord: ☕🍩)
}

const telegramCachePrefix = 'telegram:card:'

/**
 * React to the user's command message, ignoring failures (some chats
 * disallow reactions). Fire-and-forget, like Discord's message.react().
 *
 * @param tgCtx
 * @param emoji
 * @returns {void}
 */
function react(tgCtx, emoji)
{
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
 * React and bail for blocked users.
 *
 * @param ctx
 * @returns {boolean} true when the user is blocked (stop processing)
 */
function checkUserStatus(ctx)
{
    const {tgCtx, user, command} = ctx
    if (user.status !== 'active') {
        console.log('blocked user', user, command)
        react(tgCtx, reactions.blocked)
        if (user.mode) tgCtx.reply(user.mode)

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
    const {tgCtx, redis, language} = ctx
    if (!bot.isDeckLink(ctx.command) && !bot.isDeckCode(ctx.command))
        return false

    //command is lowercased, but we need the original deck code
    const command = bot.getDeckCode(tgCtx.update.message.text)
    //check if the deck is already in the cache
    const deckKey = cacheKeyPrefix + 'deck:' + language + ':' + command
    if (await redis.exists(deckKey)) {
        const response = await redis.json.get(deckKey, '$')
        console.log('serving deck from cache', deckKey)
        react(tgCtx, reactions.success)
        await tgCtx.replyWithPhoto(response.files[0])
        await tgCtx.reply(response.content.replaceAll('```', ''))
        await tgCtx.replyWithPhoto(response.files[1])

        return true
    }

    const deckInfo = await analyseDeck(command, language)
    if (!deckInfo) {
        await tgCtx.reply(translate(language, 'error'))

        return true
    }

    //tell the user to wait if a screenshot capture is already running
    const screenshotKey = cacheKeyPrefix + 'screenshot'
    if (await redis.exists(screenshotKey)) {
        react(tgCtx, reactions.wait)
        await tgCtx.reply(translate(language, 'screenshotRunning'))

        return true
    }

    //lock the screenshot process
    await redis.set(screenshotKey, 'running')
    redis.expire(screenshotKey, 120) // auto-expire after 120 seconds

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
        filename = await takeScreenshot(url)
        console.log('createDeckImages finished')

        if (filename) {
            const files = getDeckFiles(filename)
            react(tgCtx, reactions.success)
            await tgCtx.replyWithPhoto({source: files[0]})
            await tgCtx.reply(deckInfo.replaceAll('```', ''))
            await tgCtx.replyWithPhoto({source: files[1]})
        } else {
            await tgCtx.reply(translate(language, 'error'))
        }
    } finally {
        //cleanup redis lock
        redis.del(screenshotKey)

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
    const {tgCtx, language} = ctx
    try {
        const fileSize = await bot.getFileSize(url)
        if (!fileSize || fileSize >= maxFileSize) {
            await tgCtx.reply(translate(language, 'error'))

            return true
        }
        react(tgCtx, reactions.success)
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
    const {tgCtx, language} = ctx
    const syn = await getSynonym(ctx.command)
    if (!syn) return false

    let value = syn.value
    //JSON-format synonym
    if (value.startsWith('{')) {
        const m = JSON.parse(value)
        //send every image when a custom command returns more than one
        if (m.files && m.files.length) {
            try {
                react(tgCtx, reactions.success)
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
        react(tgCtx, reactions.success)
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
            console.log('Sending image by file_id:', file.attachment)

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
    const {tgCtx, language, command, limit} = ctx
    const variables = {
        language: language,
        q: command,
        showSpawnables: true,
        showReserved: true,
    }
    const cards = await getCards(variables)
    if (!cards) return true
    if (!cards.counter) {
        react(tgCtx, reactions.noResult)
        await tgCtx.reply(translate(language, 'noresult'))

        return true
    }

    const files = getFiles(cards, language, limit)
    await tgCtx.reply(translate(language, 'search') + ': ' + cards.counter)

    const downloadedFiles = []
    try {
        if (!await convertFilesForTelegram(ctx, files, downloadedFiles))
            return true

        //flag when more cards exist than fit within the limit
        react(tgCtx, cards.counter > limit
            ? reactions.moreResults
            : reactions.success)

        if (cards.counter > 1) await sendCardMediaGroup(ctx, files)
        else await sendCardPhoto(ctx, files[0])
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
    if (checkUserStatus(ctx)) return

    //switch language
    if (await handleLanguageSwitch(ctx)) return
    //update user and resolve the language to use
    await persistUser(ctx)

    //save the message
    const commandToSave = `Telegram | ${ctx.chatName} | -> ${ctx.command}`
    createMessage({authorId: ctx.user.id, content: commandToSave}).then()

    if (await handleStats(ctx)) return
    if (await handleHelp(ctx)) return

    if (!ctx.command.length) return //do nothing if it's just the prefix
    if (ctx.command.length < minStrLen)
        return tgCtx.reply(translate(ctx.language, 'min'))

    if (await handleDeck(ctx)) return
    if (await resolveSynonym(ctx)) return

    await handleSearch(ctx)
}

module.exports = {telegramHandler}
