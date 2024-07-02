const axios = require('axios')
const fs = require('fs')

/**
 *
 * @param url
 * @returns {Promise<void>}
 */
async function downloadImage(url) {

    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 5000,
    })

     return response.data
}

/**
 *
 * @param imagePath
 * @param expiration
 * @returns {Promise<*|boolean>}
 */
async function uploadImage(imagePath, expiration = 0)
{

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
            let buffer = await downloadImage(imagePath)
            base64Image = buffer.toString('base64')
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
    }
}

module.exports = {uploadImage}


