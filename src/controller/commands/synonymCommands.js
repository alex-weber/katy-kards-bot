const {getSynonym, updateSynonym} = require("../../database/db")
const {
    isManager,
    listSynonyms,
    handleSynonym,
} = require("../../tools/search")
const {
    cacheKeyPrefix,
    getGuildPart,
    forwardCachedMessage,
    cacheSentMessage,
} = require("../messageCache")
const {downloadImageAsFile} = require("../../tools/imageUpload")
const {translate} = require("../../tools/translation/translator")
const {getButtonRow} = require("../../tools/button")
const dictionary = require("../../tools/dictionary")
const {react} = require("../../tools/reactions")
const {synonymCacheExp, invalidateSynonymCache} = require("../synonymCache")

/**
 * Add or edit a synonym (managers only).
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleManageSynonym(ctx)
{
    const {command, user, message} = ctx
    if (!command.startsWith('^') || !isManager(user)) return false

    await message.channel.send(await handleSynonym(user, message))

    return true
}

/**
 * Find the longest common prefix shared by all strings in arr.
 *
 * @param arr
 * @returns {string}
 */
function findCommonPrefix(arr)
{
    if (!arr.length) return ''
    let prefix = arr[0]
    for (let i = 1; i < arr.length; i++) {
        let j = 0
        while (j < prefix.length && j < arr[i].length &&
            prefix[j] === arr[i][j]) j++
        prefix = prefix.slice(0, j)
        if (!prefix) break
    }

    return prefix.trim()
}

/**
 * Reply with a button that reveals the command list privately on click.
 * The list itself is built per-click so it is always current and only
 * visible (ephemeral) to the user who pressed the button.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleListCommands(ctx)
{
    const {command, message, language} = ctx
    if (!command.startsWith('commands')) return false

    const row = getButtonRow(
        translate(language, 'commandsButton'), 'show_commands:' + command)
    await message.channel.send({
        content: translate(language, 'commandsPrompt'),
        components: row,
    })

    return true
}

/**
 * Build the synonym list as Discord-sized message chunks.
 *
 * @param command
 * @returns {Promise<string[]|null>} chunks, or null when none exist
 */
async function buildCommandList(command)
{
    const commands = await listSynonyms(command)
    if (!commands) return null

    const isFiltered = command.trim().split(' ').length > 1
    const overallTotal = commands.reduce((acc, arr) => acc + arr.length, 0)
    const messages = []
    let messageText = isFiltered ? '' : `**TOTAL: ${overallTotal}**\n\n`

    //append a group block, flushing the buffer when it grows too large
    const appendGroupBlock = (header, items) => {
        if (!items.length) return

        const list = '```\n' + items.join('\n') + '\n```\n'
        const groupBlock = isFiltered
            ? `**${items.length}**\n${list}`
            : `**${header.toUpperCase()} (${items.length})**\n${list}`

        if (messageText.length + groupBlock.length > 1900) {
            messages.push(messageText)
            messageText = ''
        }

        messageText += groupBlock
    }

    for (const group of commands) {
        if (isFiltered) {
            // filtered: detect common prefix
            const prefix = findCommonPrefix(group)
            appendGroupBlock(prefix || '', group)
        } else {
            appendGroupedByLetter(group, appendGroupBlock)
        }
    }

    if (messageText.trim()) messages.push(messageText)

    return messages
}

/**
 * Default view: group consecutive synonyms by their first letter.
 *
 * @param group
 * @param appendGroupBlock
 * @returns {void}
 */
function appendGroupedByLetter(group, appendGroupBlock)
{
    let lastKey = ''
    let groupItems = []

    for (const synonym of group) {
        const key = synonym[0]

        if (key !== lastKey && groupItems.length > 0) {
            appendGroupBlock(lastKey, groupItems)
            groupItems = []
        }

        groupItems.push(synonym)
        lastKey = key
    }

    appendGroupBlock(lastKey, groupItems)
}

/**
 * Download a synonym's image files into Discord attachment objects.
 *
 * @param files
 * @returns {Promise<Array>}
 */
async function buildAnswerFiles(files)
{
    const attachments = []
    for (const file of files) {
        const path = await downloadImageAsFile(file)
        attachments.push({attachment: path})
    }

    return attachments
}

/**
 * Handle a JSON-formatted synonym value.
 *
 * @param ctx
 * @param m parsed synonym JSON
 * @returns {Promise<{stop: boolean, altCommand?: string}>}
 */
async function handleJsonSynonym(ctx, m)
{
    const {message, client, redis, command, user} = ctx
    const cacheKey =
        cacheKeyPrefix + getGuildPart(message) + 'syn:' + command
    if (await redis.exists(cacheKey) && !m.content) {
        const cached = await redis.json.get(cacheKey, '$')
        if (await forwardCachedMessage(
            client, cached, message.channel, message.channelId))
            return {stop: true}
        //forward failed (e.g. no Read Message History) -> rebuild below
    }

    const answer = {}
    let altCommand = ''
    if (m.content) {
        if (m.content.startsWith('text:'))
            answer.content = m.content.replace('text:', '')
        else
            altCommand = m.content
    }

    if (altCommand) return {stop: false, altCommand}

    if (m.files) answer.files = await buildAnswerFiles(m.files)

    react(message, '✅', user)
    const sent = await message.channel.send(answer)
    await cacheSentMessage(redis, cacheKey, sent, synonymCacheExp)

    return {stop: true}
}

/**
 * Resolve a synonym: either reply (stop) or rewrite ctx.command for search.
 *
 * @param ctx
 * @returns {Promise<boolean>} true when the command was fully handled
 */
async function resolveSynonym(ctx)
{
    const {message, command, user} = ctx
    const syn = await getSynonym(command)
    if (!syn) {
        if (command in dictionary.synonyms)
            ctx.command = dictionary.synonyms[command]

        return false
    }

    let altCommand = ''
    if (syn.value.startsWith('{')) {
        const m = JSON.parse(syn.value)
        const result = await handleJsonSynonym(ctx, m)
        if (result.stop) return true
        altCommand = result.altCommand
    }

    //old format: a bare image link, upgrade it to JSON
    if (syn.value.startsWith('http')) {
        const answer = {files: [syn.value]}
        await updateSynonym(syn.key, JSON.stringify(answer))
        await invalidateSynonymCache(syn.key)
        await message.channel.send(answer)

        return true
    }

    //a plain text reply
    if (syn.value.startsWith('text:')) {
        const answer = {content: syn.value}
        await updateSynonym(syn.key, JSON.stringify(answer))
        await invalidateSynonymCache(syn.key)
        answer.content = answer.content.replace('text:', '')
        react(message, '✅', user)
        await message.channel.send(answer)

        return true
    }

    //else use the value as the alternate command for search
    ctx.command = altCommand || syn.value

    return false
}

module.exports = {
    handleManageSynonym,
    handleListCommands,
    buildCommandList,
    resolveSynonym,
}
