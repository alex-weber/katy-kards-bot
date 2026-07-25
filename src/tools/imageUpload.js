const axios = require('axios')
const fs = require('fs')
const sharp = require('sharp')
const path = require('path')
const { pipeline } = require('stream/promises')
const { safeImageUrl, isAllowedImageHost } = require('./imageUrl')

// Configure sharp to use less memory
sharp.cache({ memory: 50 }) // Limit cache to 50MB
sharp.concurrency(1) // Process one image at a time to reduce memory spikes

async function downloadImageAsFile(url, language = null) {

    const safeUrl = safeImageUrl(url)
    if (!safeUrl) {
        console.error('Refused to download an image from a host that is not allowlisted:', url)
        throw new Error('Image host is not allowed')
    }

    let fileName = path.basename(
        safeUrl.split('?')[0]
    )

    if (language)
        fileName = `${language}_${fileName}`

    const filePath = path.join(
        __dirname,
        '../tmp/downloads',
        fileName
    )

    try {
        await fs.promises.access(filePath)
        return filePath
    } catch {}

    const response = await axios({
        url: safeUrl,
        method: 'GET',
        responseType: 'stream',
        timeout: 10000,
        // An allowlisted host answering with a redirect would otherwise walk
        // straight past the check above, so every hop is validated again.
        beforeRedirect: (options) => {
            if (options.protocol !== 'https:' || !isAllowedImageHost(String(options.hostname).toLowerCase())) {
                throw new Error('Image host redirected to a host that is not allowed')
            }
        }
    })

    await pipeline(
        response.data,
        fs.createWriteStream(filePath)
    )

    return filePath
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

        const response = await axios.post(process.env.IMG_UPLOAD_API_ENDPOINT, postData)

        // Clear base64 string from memory after upload
        postData.image = null

        if (response.status !== 200) {
            console.error('Error uploading image:', response.message)
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
}


