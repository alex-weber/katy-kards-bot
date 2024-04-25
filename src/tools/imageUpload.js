const axios = require('axios')
const fs = require('fs')

/**
 *
 * @param imagePath
 * @returns {Promise<string|boolean>}
 */
async function uploadImage(imagePath)
{

    if (!process.env.IMG_UPLOAD_API_KEY)
    {
        console.log('no upload api key set')
        return false
    }
    try
    {
        const API_ENDPOINT = 'https://api.imgbb.com/1/upload?key=' + process.env.IMG_UPLOAD_API_KEY
        const imageData = fs.readFileSync(imagePath)
        const base64Image = Buffer.from(imageData).toString('base64')

        const formData = new FormData()
        formData.append('image', base64Image)

        const response = await axios.post(API_ENDPOINT, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        })

        console.log('Image uploaded successfully:', response.data.data.url)

        return response.data.data.url
    } catch (error)
    {
        console.error('Error uploading image:', error.response ? error.response.data : error.message)

        return false
    }
}

module.exports = {uploadImage}


