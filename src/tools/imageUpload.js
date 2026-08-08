const fs = require('fs')
const crypto = require('crypto')
const sharp = require('sharp')
const path = require('path')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const { safeImageUrl, isAllowedImageHost } = require('./imageUrl')
const { fetchJson } = require('./fetch')

// Configure sharp to use less memory
sharp.cache({ memory: 50 }) // Limit cache to 50MB
sharp.concurrency(1) // Process one image at a time to reduce memory spikes

/**
 * Where a URL is kept on disk once downloaded.
 *
 * Named after a digest of the URL rather than its last path segment: a
 * basename is not unique — Discord serves any number of attachments called
 * image.png — and downloadImageAsFile() reuses whatever is already sitting
 * under the target name. Keyed by basename alone, the second command posting an
 * image.png silently served the first one's picture, for as long as the file
 * stayed in the temp directory.
 *
 * The query string is left out of the digest on purpose: Discord's attachment
 * URLs carry an expiring signature that changes for the same image, while the
 * path holds the attachment id, so the path alone is the stable identity. That
 * keeps the download cache working instead of re-fetching on every signature.
 *
 * The original name is kept in front, sanitized and short, only so the temp
 * directory stays readable.
 *
 * @param safeUrl URL that already passed safeImageUrl()
 * @param language optional prefix, as before
 * @returns {string}
 */
function cacheFileName(safeUrl, language = null) {
    const address = safeUrl.split('?')[0]
    const digest = crypto.createHash('sha256').update(address).digest('hex').slice(0, 16)

    // The readable part comes off the URL's path, not off the address as a
    // whole: path.basename() of a host-root URL hands back the hostname.
    const base = path.basename(new URL(safeUrl).pathname)
    const rawExtension = path.extname(base)
    const extension = /^\.[a-z0-9]{1,8}$/i.test(rawExtension) ? rawExtension.toLowerCase() : ''
    const stem = path.basename(base, rawExtension).replace(/[^a-z0-9_-]/gi, '').slice(0, 24)

    return `${language ? language + '_' : ''}${stem ? stem + '-' : ''}${digest}${extension}`
}

async function downloadImageAsFile(url, language = null) {

    const safeUrl = safeImageUrl(url)
    if (!safeUrl) {
        console.error('Refused to download an image from a host that is not allowlisted:', url)
        throw new Error('Image host is not allowed')
    }

    const filePath = path.join(
        __dirname,
        '../tmp/downloads',
        cacheFileName(safeUrl, language)
    )

    try {
        await fs.promises.access(filePath)
        return filePath
    } catch {}

    const response = await fetchAllowingRedirects(safeUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
    })

    await pipeline(
        Readable.fromWeb(response.body),
        fs.createWriteStream(filePath)
    )

    return filePath
}

/**
 * A GET that follows redirects by hand so each hop can be re-checked against
 * the image-host allowlist.
 *
 * fetch() follows redirects on its own but gives no hook to vet where they
 * lead, so they are followed here with `redirect: 'manual'`: an allowlisted
 * host that answers a 3xx still cannot walk the download off to a host — or off
 * TLS — that safeImageUrl() would have refused up front.
 *
 * @param safeUrl a URL that already passed safeImageUrl()
 * @param options fetch() options; `redirect` is set here and cannot be overridden
 * @param maxRedirects
 * @returns {Promise<Response>}
 */
async function fetchAllowingRedirects(safeUrl, options, maxRedirects = 5) {
    let url = safeUrl

    for (let hop = 0; ; hop++) {
        const response = await fetch(url, { ...options, redirect: 'manual' })

        // Anything that is not a redirect is the response the caller asked for.
        const location = response.status >= 300 && response.status < 400
            ? response.headers.get('location')
            : null
        if (!location) return response

        if (hop >= maxRedirects) throw new Error('Image host redirected too many times')

        // Same check safeImageUrl() runs on the first URL, applied to each hop.
        const next = new URL(location, url)
        if (next.protocol !== 'https:' || !isAllowedImageHost(next.hostname.toLowerCase())) {
            throw new Error('Image host redirected to a host that is not allowed')
        }
        url = next.href
    }
}

/**
 * @returns {boolean} whether an image host is configured at all
 */
function hasImageHost()
{
    if (process.env.IMG_UPLOAD_API_KEY && process.env.IMG_UPLOAD_API_ENDPOINT) return true

    console.log('no upload api key or endpoint set')

    return false
}

/**
 * Send a file that is already on disk to the image host.
 *
 * @param filePath file inside our own tmp directory
 * @param expiration
 * @param hostPath optional folder for the host to file the image under
 * @returns {Promise<*|boolean>} the hosted URL, or false
 */
async function postImageFile(filePath, expiration, hostPath = null)
{
    let imageBuffer = null

    try {
        const postData = {
            key: process.env.IMG_UPLOAD_API_KEY,
        }
        if (expiration) postData.expiration = expiration
        if (hostPath) postData.path = hostPath

        // Use async file reading to avoid blocking
        imageBuffer = await fs.promises.readFile(filePath)
        postData.image = imageBuffer.toString('base64')
        imageBuffer = null // Release immediately after conversion

        const response = await fetchJson(process.env.IMG_UPLOAD_API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(postData),
        })

        // Clear base64 string from memory after upload
        postData.image = null

        if (response.status !== 200) {
            console.error('Error uploading image:', response.statusText)
            return false
        }
        console.log('Image uploaded successfully:', response.data.url)

        return response.data.url
    } finally {
        // Ensure buffers are cleared
        imageBuffer = null
    }
}

/**
 * Re-host an image we already have on disk — an admin's upload from the
 * dashboard, which multer has written into our tmp directory.
 *
 * Deliberately separate from uploadImageFromUrl(): one takes a path and never
 * makes an outbound request of its own, the other takes a URL and fetches it.
 * Deciding between the two by asking whether the string starts with 'http'
 * meant a caller holding a file path was one bad value away from making the
 * bot fetch a URL, which is a distinction worth having in the signature.
 *
 * @param filePath
 * @param expiration
 * @returns {Promise<*|boolean>}
 */
async function uploadImageFile(filePath, expiration = 0)
{
    if (!hasImageHost()) return false

    try {
        return await postImageFile(filePath, expiration)
    } catch (error) {
        console.error('Error uploading image:', error)

        return false
    }
}

/**
 * Re-host an image that lives somewhere else — a Discord attachment, whose URL
 * expires after two weeks. The URL is checked against the host allowlist by
 * downloadImageAsFile() before anything is fetched.
 *
 * @param url
 * @param expiration
 * @returns {Promise<*|boolean>}
 */
async function uploadImageFromUrl(url, expiration = 0)
{
    if (!hasImageHost()) return false

    let downloadedPath = null

    try {
        const imageExtension = url.split('.').pop().split('?').shift().toLowerCase()
        downloadedPath = await downloadImageAsFile(url)

        if (imageExtension === 'png' || imageExtension === 'jpg' || imageExtension === 'jpeg')
        {
            downloadedPath = await convertImageToWEBP(downloadedPath)
        }

        return await postImageFile(downloadedPath, expiration, 'custom')
    } catch (error) {
        console.error('Error uploading image:', error)

        return false
    } finally {
        // Clean up temporary files
        if (downloadedPath) {
            try {
                await fs.promises.unlink(downloadedPath)
            } catch (err) {
                if (err.code !== 'ENOENT') console.error('Error cleaning up downloaded file:', err)
            }
        }
    }
}

/**
 *
 * @param imagePath
 * @returns {Promise<string>}
 */
async function convertImageToWEBP(imagePath) {

    let sharpInstance = null

    try {
        // Define the new path for the WEBP version
        const webpPath = path.join(path.dirname(imagePath), `${path.parse(imagePath).name}.webp`)

        // Create a sharp instance
        sharpInstance = sharp(imagePath)
        const fileType = await sharpInstance.metadata()

        if (
            fileType.format === 'png' ||
            fileType.format === 'heif' ||
            fileType.format === 'avif' ||
            fileType.format === 'jpeg'
        )
        {
            // Clean up the first instance and create a new one for conversion
            sharpInstance.destroy()
            sharpInstance = null

            // Convert the image to WEBP with optimized settings
            await sharp(imagePath)
                .toFormat('webp', { quality: 85 })
                .toFile(webpPath)
        }

        return webpPath
    } catch (error) {
        // imagePath is passed as an argument, never interpolated into the first
        // one: console.* treats that as a format string, so a %s in a path the
        // bot did not choose would swallow the error being reported.
        console.error('Failed to process image from', imagePath, error)
        throw error
    } finally {
        // Ensure sharp instance is destroyed
        if (sharpInstance) {
            sharpInstance.destroy()
            sharpInstance = null
        }
    }

}

module.exports = {
    uploadImageFile,
    uploadImageFromUrl,
    downloadImageAsFile,
    convertImageToWEBP,
    cacheFileName,
}


