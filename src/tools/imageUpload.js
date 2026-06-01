const axios = require('axios')
const fs = require('fs')
const sharp = require('sharp')
const path = require('path')

// Configure sharp to use less memory
sharp.cache({ memory: 50 }) // Limit cache to 50MB
sharp.concurrency(1) // Process one image at a time to reduce memory spikes

async function downloadImageAsFile(url, language=null) {
    try {
        // Extract the file name from the URL
        let fileName = path.basename(url.split('?')[0])
        if (language) fileName = language + '_' + fileName
        const filePath = path.join(__dirname, '../tmp/downloads', fileName)

        if (fs.existsSync(filePath))
        {
            console.log('File already exists, returning:', fileName)

            return filePath
        }
        // Ensure the downloads directory exists
        if (!fs.existsSync(path.dirname(filePath))) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true })
        }

        // Download the image
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        })

        // Save the file locally
        const writer = fs.createWriteStream(filePath)
        response.data.pipe(writer)

        // Wait for the file to finish writing
        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(filePath))
            writer.on('error', (err) => {
                writer.close()
                fs.unlink(filePath, () => {}) // Clean up partial file
                reject(err)
            })
            response.data.on('error', (err) => {
                writer.close()
                fs.unlink(filePath, () => {}) // Clean up partial file
                reject(err)
            })
        })
    } catch (error) {
        console.error(`Error downloading image from ${url}:`, error)
        throw error
    }
}

/**
 * 
 * @param url
 * @returns {Promise<Buffer|boolean>}
 */
async function downloadImageAsBuffer(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 5000,
        })

        if (!response || response.status !== 200)
            return false

        return response.data
    } catch (error) {
        console.error(`Error downloading image buffer from ${url}:`, error.message)
        return false
    }
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
    let convertedPath = null
    let imageBuffer = null

    if (!process.env.IMG_UPLOAD_API_KEY || !process.env.IMG_UPLOAD_API_ENDPOINT)
    {
        console.log('no upload api key or endpoint set')
        return false
    }
    try
    {
        const API_URL = process.env.IMG_UPLOAD_API_ENDPOINT
        let base64Image
        const postData = {
            key: process.env.IMG_UPLOAD_API_KEY,
        }
        if (expiration) postData.expiration = expiration

        //custom image. should never expire
        if (imagePath.startsWith('http'))
        {
            const imageExtension = imagePath.split('.').pop().split('?').shift().toLowerCase()

            if (imageExtension === 'png')
            {
                downloadedPath = await downloadImageAsFile(imagePath)
                convertedPath = await convertImageToWEBP(downloadedPath)
                // Use async file reading to avoid blocking
                imageBuffer = await fs.promises.readFile(convertedPath)
                base64Image = imageBuffer.toString('base64')
                imageBuffer = null // Release immediately after conversion
            } else {
                imageBuffer = await downloadImageAsBuffer(imagePath)
                if (!imageBuffer) {
                    console.error('Error uploading image, bad API response')
                    return false
                }
                base64Image = imageBuffer.toString('base64')
                imageBuffer = null // Release buffer reference immediately
            }
            postData.path = 'custom'
        } else { //cache image. should expire
            // Use async file reading
            imageBuffer = await fs.promises.readFile(imagePath)
            base64Image = imageBuffer.toString('base64')
            imageBuffer = null // Release immediately after conversion
        }

        postData.image = base64Image
        const response = await axios.post(API_URL, postData)

        // Clear base64 string from memory after upload
        base64Image = null
        postData.image = null

        if (response.status !== 200) {
            console.error('Error uploading image:', response.message)
            return false
        }
        console.log('Image uploaded successfully:', response.data.url)

        return response.data.url

    } catch (error)
    {
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
        if (convertedPath) {
            try {
                await fs.promises.unlink(convertedPath)
            } catch (err) {
                if (err.code !== 'ENOENT') console.error('Error cleaning up converted file:', err)
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

        if (fileType.format === 'png' || fileType.format === 'heif' || fileType.format === 'avif') {
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


