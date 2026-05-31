const axios = require('axios')
const fs = require('fs')
const sharp = require('sharp')
const path = require('path')

async function downloadImageAsFile(url, language=null) {
    try {
        // Extract the file name from the URL
        let fileName = path.basename(url.split('?')[0])
        if (language) fileName = language + '_' + fileName
        const filePath = path.join(__dirname, '../tmp/downloads', fileName)

        if (language && fs.existsSync(filePath))
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
                const imageData = fs.readFileSync(convertedPath)
                base64Image = Buffer.from(imageData).toString('base64')
            } else {
                let buffer = await downloadImageAsBuffer(imagePath)
                if (!buffer) {
                    console.error('Error uploading image, bad API response')
                    return false
                }
                base64Image = buffer.toString('base64')
                buffer = null // Release buffer reference
            }
            postData.path = 'custom'
        } else { //cache image. should expire
            const imageData = fs.readFileSync(imagePath)
            base64Image = Buffer.from(imageData).toString('base64')
        }

        postData.image = base64Image
        const response = await axios.post(API_URL, postData)
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
        // Clean up temporary files
        if (downloadedPath && fs.existsSync(downloadedPath)) {
            fs.unlink(downloadedPath, (err) => {
                if (err) console.error('Error cleaning up downloaded file:', err)
            })
        }
        if (convertedPath && fs.existsSync(convertedPath)) {
            fs.unlink(convertedPath, (err) => {
                if (err) console.error('Error cleaning up converted file:', err)
            })
        }
    }
}

/**
 *
 * @param imagePath
 * @returns {Promise<string>}
 */
async function convertImageToWEBP(imagePath) {

    try {
        // Define the new path for the WEBP version
        const webpPath = path.join(path.dirname(imagePath), `${path.parse(imagePath).name}.webp`)

        // Create sharp instance
        const sharpInstance = sharp(imagePath)
        const fileType = await sharpInstance.metadata()

        if (fileType.format === 'png' || fileType.format === 'heif') {
            // Convert the image to WEBP
            await sharp(imagePath)
                .toFormat('webp')
                .toFile(webpPath)
        }

        // Clean up sharp cache for this operation
        sharpInstance.destroy()

        return webpPath
    } catch (error) {
        console.error(`Failed to process image from ${imagePath}:`, error)
        throw error
    }

}

module.exports = {
    uploadImage,
    downloadImageAsFile,
    convertImageToWEBP
}


