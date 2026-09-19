//Widths that keep the segments in a column when the lines are read in a
//terminal. Long values simply push their column out instead of being cut.
const kindWidth = 8   // 'midnight'
const srcWidth = 9    // 'dc/button'

//the order timings are printed in, so two lines are always comparable
const timingOrder = ['api', 'db', 'shot', 'cache', 'usr', 'perm']

/**
 * Render a millisecond duration compactly: one decimal under 10ms (sub-ms
 * lookups stay legible), whole numbers above.
 *
 * @param ms
 * @returns {string}
 */
function fmtMs(ms)
{
    if (ms == null) return '?'

    return (ms < 10 ? ms.toFixed(1) : Math.round(ms)) + 'ms'
}

/**
 * Describe who acted and where, from a Discord message.
 *
 * @param ctx the Discord command context
 * @returns {{src: string, who: string, where: string}}
 */
function discordActor(ctx)
{
    const {message = {}, guildName, channelName} = ctx

    return {
        src: 'dc/' + (message.isSlash
            ? 'slash'
            : message.buttonId ? 'button' : 'text'),
        who: message.authorName || message.author?.username || 'unknown',
        where: guildName ? `${guildName}#${channelName}` : 'DM',
    }
}

/**
 * Describe who acted and where, from a Telegram context. Callback queries
 * (button taps) carry the sender on callbackQuery, text commands on the
 * message, so both are read here.
 *
 * @param ctx the Telegram command context
 * @returns {{src: string, who: string, where: string}}
 */
function telegramActor(ctx)
{
    const {tgCtx = {}, chatName} = ctx
    const from = tgCtx.callbackQuery?.from || tgCtx.update?.message?.from || {}
    const who = from.username || from.first_name ||
        (from.id != null ? String(from.id) : 'unknown')

    return {
        src: 'tg/' + (tgCtx.callbackQuery ? 'button' : 'text'),
        who,
        where: chatName || tgCtx.chat?.title || 'private',
    }
}

/**
 * The page segment for a paginated answer: the page number, plus the raw
 * offset once past the first page so a "Next" click can be traced back.
 *
 * @param offset
 * @param limit
 * @returns {string}
 */
function formatPage(offset, limit)
{
    offset = offset || 0
    if (!limit) return 'p1'

    return 'p' + (Math.floor(offset / limit) + 1) + (offset ? ' off' + offset : '')
}

/**
 * Build one structured, greppable summary line for a user interaction, folding
 * in the platform and how it arrived, who ran it and where, the query, cache
 * HIT/MISS, the page and the per-step timings. Kept pure (returns the string)
 * so every call site and both platforms share a single format. Example:
 *   search · dc/button · rainy@KARDS#general · q="zhukov" · MISS · p2 off5 · 3 found · api 76ms
 *
 * @param kind what the user asked for ('search', 'deck', 'alt', …)
 * @param actor {src, who, where}
 * @param meta {q, cache, page, result, timings}
 * @returns {string}
 */
function formatCommandLog(kind, actor, meta = {})
{
    const parts = [
        String(kind).padEnd(kindWidth),
        String(actor.src).padEnd(srcWidth),
        `${actor.who}@${actor.where}`,
    ]
    if (meta.q) parts.push(`q="${meta.q}"`)
    if (meta.cache) parts.push(meta.cache)
    if (meta.page) parts.push(meta.page)
    if (meta.result) parts.push(meta.result)

    const timings = meta.timings || {}
    const t = timingOrder
        .filter(key => timings[key] != null)
        .map(key => key + ' ' + fmtMs(timings[key]))
    if (t.length) parts.push(t.join(' '))

    return parts.join(' · ')
}

/**
 * Enrich the line the dispatcher will emit for this interaction. Handlers call
 * this instead of logging themselves, the same way they already fill
 * ctx.timings — so the line is written in exactly one place per platform and a
 * new command cannot be added without being logged.
 *
 * @param ctx
 * @param meta merged into ctx.log
 * @returns {void}
 */
function setLog(ctx, meta)
{
    if (!ctx.log) ctx.log = {}
    Object.assign(ctx.log, meta)
}

/**
 * Record one measured step on the interaction's timing sink, so every line
 * reports everything that was measured for it - a cache hit that spent 200ms
 * checking permissions should not look instant.
 *
 * @param ctx
 * @param key one of timingOrder
 * @param ms
 * @returns {void}
 */
function addTiming(ctx, key, ms)
{
    if (!ctx.timings) ctx.timings = {}
    ctx.timings[key] = ms
}

/**
 * Emit the summary line for a finished interaction.
 *
 * @param kind what the user asked for
 * @param ctx
 * @param actor discordActor(ctx) or telegramActor(ctx)
 * @returns {void}
 */
function logCommand(kind, ctx, actor)
{
    const meta = {q: ctx.command, ...(ctx.log || {})}
    //the handler's own timings sink is the one the API/DB helpers write into
    if (!meta.timings && ctx.timings) meta.timings = ctx.timings

    console.log(formatCommandLog(kind, actor, meta))
}

module.exports = {
    fmtMs,
    addTiming,
    formatCommandLog,
    formatPage,
    discordActor,
    telegramActor,
    setLog,
    logCommand,
}
