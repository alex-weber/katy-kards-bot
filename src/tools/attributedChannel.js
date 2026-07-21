const {translate} = require('./translation/translator')

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
 * @param user
 * @param language
 * @param query the command text (e.g. a search query), if known
 * @returns {*}
 */
function withAttribution(payload, user, language, query)
{
    if (payload && typeof payload === 'object' && payload.forward) return payload

    const tag = query
        ? translate(language, 'requestedByQuery', {name: user.username, query})
        : translate(language, 'requestedBy', {name: user.username})
    if (typeof payload === 'string') return `${tag}\n${payload}`
    if (payload && typeof payload === 'object') {
        return {...payload, content: payload.content ? `${tag}\n${payload.content}` : tag}
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
 * @param user the discord.js User whose action triggered the send
 * @param language language for the attribution line
 * @param query optional command text (e.g. the search query) to include in
 *   the attribution line, so moderators can see not just who but what
 * @returns {*} a proxy exposing the same channel API, with .send wrapped
 */
function attributeChannel(channel, user, language, query)
{
    if (!channel) return channel

    return new Proxy(channel, {
        get(target, prop)
        {
            if (prop === 'send') {
                return payload => target.send(withAttribution(payload, user, language, query))
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
