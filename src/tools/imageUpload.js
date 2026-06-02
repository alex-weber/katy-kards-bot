const axios = require('axios')
const fs = require('fs')
const sharp = require('sharp')
const path = require('path')
const { pipeline } = require('stream/promises')

// Configure sharp to use less memory
sharp.cache({ memory: 50 }) // Limit cache to 50MB
sharp.concurrency(1) // Process one image at a time to reduce memory spikes

async function downloadImageAsFile(url, language = null) {

    let fileName = path.basename(
        url.split('?')[0]
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
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 10000
    })

    await pipeline(
        response.data,
        fs.createWriteStream(filePath)
    )

    return filePath
}

/**
 *
 * @param imagePath
 * @param expiration
 * @returns {Promise<*|boolean>}
 */
async function uploadImage(imagePath, expiration = 0)
{
    let downloadedPath = null
    let imageBuffer = null

    if (!process.env.IMG_UPLOAD_API_KEY || !process.env.IMG_UPLOAD_API_ENDPOINT)
    {
        console.log('no upload api key or endpoint set')
        return false
    }
    try
    {
        const API_URL = process.env.IMG_UPLOAD_API_ENDPOINT

        const postData = {
            key: process.env.IMG_UPLOAD_API_KEY,
        }
        if (expiration) postData.expiration = expiration

        //read file from URL
        if (imagePath.startsWith('http'))
        {
            const imageExtension = imagePath.split('.').pop().split('?').shift().toLowerCase()
            downloadedPath = await downloadImageAsFile(imagePath)

            if (imageExtension === 'png' || imageExtension === 'jpg' || imageExtension === 'jpeg')
            {
                downloadedPath = await convertImageToWEBP(downloadedPath)
            }
            // Use async file reading to avoid blocking
            imageBuffer = await fs.promises.readFile(downloadedPath)
            postData.image = imageBuffer.toString('base64')
            imageBuffer = null // Release immediately after conversion
            postData.path = 'custom'
        } else {
            //read file from disk
            imageBuffer = await fs.promises.readFile(imagePath)
            postData.image = imageBuffer.toString('base64')
            imageBuffer = null // Release immediately after conversion
        }

        const response = await axios.post(API_URL, postData)

        // Clear base64 string from memory after upload
        postData.image = null

        if (response.status !== 200) {
            console.error('Error uploading image:', response.message)
            return false
        }
        console.log('Image uploaded successfully:', response.data.url)

        return response.data.url

    } catch (error) {
        console.error('Error uploading image:', error)

        return false
    } finally {
        // Ensure buffers are cleared
        imageBuffer = null

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
        console.error(`Failed to process image from ${imagePath}:`, error)
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
    uploadImage,
    downloadImageAsFile,
    convertImageToWEBP
}


