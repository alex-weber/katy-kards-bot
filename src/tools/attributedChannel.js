const {translate} = require('./translation/translator')

// Nothing the bot posts on someone's behalf needs to mention anyone, and the
// attribution line carries a name that person chose. Without this, a nickname
// of "@everyone" turns any slash command into a server-wide ping sent with the
// bot's permissions rather than the requester's.
const noMentions = {parse: []}

/**
 * A forward (`{forward: {...}}`, used to re-serve a cached result via
 * Message#forward) cannot carry content, so it can never be attributed.
 *
 * @param payload
 * @returns {boolean}
 */
function isForward(payload)
{
    return !!(payload && typeof payload === 'object' && payload.forward)
}

/**
 * The mention guard an attributed message gets, without the attribution line —
 * for the messages after the first one. A caller that means to ping someone can
 * still say so by setting allowedMentions itself.
 *
 * @param payload string or discord.js message-options object
 * @returns {*}
 */
function withoutMentions(payload)
{
    if (isForward(payload)) return payload
    if (typeof payload === 'string') return {content: payload, allowedMentions: noMentions}
    if (payload && typeof payload === 'object') {
        return {...payload, allowedMentions: payload.allowedMentions || noMentions}
    }

    return payload
}

/**
 * The "requested by" line naming the user whose action triggered the message
 * (and the command text they used, when known).
 *
 * @param name what to call the requester — already resolved and escaped by
 *   attributionName(), so it is interpolated as-is
 * @param language
 * @param query the command text (e.g. a search query), if known
 * @returns {string}
 */
function attributionTag(name, language, query)
{
    return query
        ? translate(language, 'requestedByQuery', {name, query})
        : translate(language, 'requestedBy', {name})
}

/**
 * Prefix a channel.send payload with a small "requested by" line naming the
 * user whose action triggered it (and the command text they used, when
 * known), without disturbing anything else already on the payload (embeds,
 * files, components, …).
 *
 * A forwarded message (`{forward: {...}}`, used to re-serve a cached result
 * via Message#forward) is left untouched: Discord rejects any `content` on a
 * forward with API error 160011 ("Forward messages cannot have additional
 * content"), so attribution is simply not possible on that path.
 *
 * @param payload string or discord.js message-options object
 * @param name what to call the requester — already resolved and escaped by
 *   attributionName(), so it is interpolated as-is
 * @param language
 * @param query the command text (e.g. a search query), if known
 * @returns {*}
 */
function withAttribution(payload, name, language, query)
{
    if (isForward(payload)) return payload

    const tag = attributionTag(name, language, query)
    if (typeof payload === 'string') return {content: `${tag}\n${payload}`, allowedMentions: noMentions}
    if (payload && typeof payload === 'object') {
        return {
            ...payload,
            content: payload.content ? `${tag}\n${payload.content}` : tag,
            allowedMentions: payload.allowedMentions || noMentions,
        }
    }

    return payload
}

/**
 * Wrap a channel so every message sent through it is attributed to the given
 * user. Needed for slash-command-driven (and button-driven) channel posts:
 * unlike the deprecated `!` commands, where the user's own message is visible
 * right above the bot's reply, these otherwise leave no public trace of who
 * asked for them — making the bot easy to abuse for spam without moderators
 * being able to tell who did it.
 *
 * @param channel a discord.js channel (or channel-like object exposing .send);
 *   passed through untouched when falsy (e.g. interaction.channel can be null
 *   when the channel isn't cached), so callers see the same null they would
 *   have without this wrapper rather than a Proxy-construction crash
 * @param name what to call the requester, from attributionName() — the name is
 *   resolved at the call site because only there is the GuildMember available
 * @param language language for the attribution line
 * @param query optional command text (e.g. the search query) to include in
 *   the attribution line, so moderators can see not just who but what
 * @returns {*} a proxy exposing the same channel API, with .send wrapped
 */
function attributeChannel(channel, name, language, query)
{
    if (!channel) return channel

    //One line per command, not per message. A handler is free to post several
    //messages for a single command — the top-deck game posts a progress
    //notice, the battle result and a ping for the opponent — and repeating the
    //attribution on each one is just noise in the channel. Naming the command
    //once is all a moderator needs to trace it.
    let attributed = false

    return new Proxy(channel, {
        get(target, prop)
        {
            if (prop === 'send') {
                return payload => {
                    //a forward can't carry the line, so it must not consume
                    //the one attribution this command gets
                    const attribute = !attributed && !isForward(payload)
                    if (attribute) attributed = true

                    return target.send(attribute
                        ? withAttribution(payload, name, language, query)
                        : withoutMentions(payload))
                }
            }
            //Post the "requested by" line as its own standalone message and
            //spend this command's one attribution on it, so a later content
            //message is sent unattributed. Needed when that content message
            //gets cached and replayed via Message#forward: a forward re-serves
            //the original message, so any attribution baked into its content
            //would ride along into every future replay (naming the first
            //requester) on top of the fresh per-replay notice. The deck
            //screenshot takes this path. No-op (resolving to null) once the
            //attribution is already spent, or when there is no name to show.
            if (prop === 'sendAttribution') {
                return () => {
                    if (attributed || !name) return Promise.resolve(null)
                    attributed = true

                    return target.send({
                        content: attributionTag(name, language, query),
                        allowedMentions: noMentions,
                    })
                }
            }
            //escape hatch for callers that already build their own fully-formed
            //attribution text (e.g. the cache-forward notice, which can't reuse
            //the generic tag above without doubling up) and just need the
            //unwrapped channel.send
            if (prop === 'sendRaw') {
                return payload => target.send(payload)
            }
            //receiver is deliberately omitted (defaults to target): discord.js
            //classes lean on private (#) fields internally, and getters/methods
            //invoked with the proxy as `this` would throw "Cannot read private
            //member from an object whose class did not declare it"
            const value = Reflect.get(target, prop)

            return typeof value === 'function' ? value.bind(target) : value
        },
    })
}

module.exports = {attributeChannel}
