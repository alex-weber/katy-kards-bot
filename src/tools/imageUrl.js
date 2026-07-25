// Hosts this process is allowed to fetch images from.
//
// Everything downloaded through imageUpload.js ends up somewhere a user can
// see: a custom command's images are posted back into the channel as
// attachments. The URLs are not ours — they come off Discord attachments and
// out of stored custom commands, and a custom command's file list is whatever
// an admin posted to /commands. Without this list that is a server-side request
// forgery: point a command at http://169.254.169.254/ or at a service bound to
// localhost and the bot fetches it and hands the response to whoever ran the
// command.
//
// Discord's CDN is built in because every attachment comes from it and the bot
// cannot work without it. The host your uploader (IMG_UPLOAD_API_ENDPOINT)
// serves finished images from is deployment-specific and belongs in the
// environment: put it in IMAGE_ALLOWED_HOSTS, as exact hosts or *.example.com
// patterns, comma-separated. Images on hosts not listed are not delivered.
const builtInImageHosts = ['cdn.discordapp.com', 'media.discordapp.net']

/**
 * @returns {string[]} host patterns images may be fetched from
 */
function allowedImageHosts() {
    const configured = (process.env.IMAGE_ALLOWED_HOSTS || '')
        .split(',')
        .map(host => host.trim().toLowerCase())
        .filter(Boolean)

    return [...builtInImageHosts, ...configured]
}

/**
 * @param hostname lower-case hostname of the URL being checked
 * @returns {boolean}
 */
function isAllowedImageHost(hostname) {
    return allowedImageHosts().some(pattern => pattern.startsWith('*.')
        // '*.example.com' covers example.com and any of its subdomains.
        ? hostname === pattern.slice(2) || hostname.endsWith(pattern.slice(1))
        : hostname === pattern)
}

/**
 * The URL to fetch, or null when this one may not be requested at all.
 *
 * An explicit port is refused as well: the allowlisted hosts all serve images
 * on the default one, so a port is only ever an attempt to reach something else.
 *
 * @param value URL from a Discord attachment or a stored custom command
 * @returns {string|null}
 */
function safeImageUrl(value) {
    let parsed
    try {
        parsed = new URL(String(value))
    } catch {
        return null
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    if (parsed.username || parsed.password || parsed.port) return null
    if (!isAllowedImageHost(parsed.hostname.toLowerCase())) return null

    // Fetch over TLS even if an older stored command still says http://.
    parsed.protocol = 'https:'

    return parsed.toString()
}

module.exports = {
    isAllowedImageHost,
    safeImageUrl,
}
