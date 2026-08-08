/**
 * A small stand-in for the slice of the axios API this codebase relied on.
 * Node ships a global fetch(), so there is nothing to import here.
 */

/**
 * Runs a request and hangs the parsed JSON body off the response as `.data`,
 * the way axios did, so call sites keep reading `response.data`.
 *
 * The body is read eagerly, so a non-JSON payload rejects here rather than at
 * the call site — the same place axios surfaced it. Unlike axios, fetch() does
 * not reject on a 4xx/5xx status, so callers that care must check
 * `response.ok` / `response.status` themselves.
 *
 * @param {string|URL} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response & {data: any}>}
 */
async function fetchJson(url, options) {
    return fetch(url, options)
        .then(async (res) => Object.assign(res, { data: await res.json() }))
}

module.exports = { fetchJson }
