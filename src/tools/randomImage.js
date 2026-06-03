const axios = require("axios")
const bot = require("../controller/bot")
const maxFileSize = 5 * 1024 * 1024 //5MB
/**
 *
 * @returns {Promise<string|boolean>}
 */
async function getRandomImage()
{

    try {
        const response = await axios.get(`https://api.thecatapi.com/v1/images/search`)
        if (response === undefined || response.status !== 200) return false
        if (!response.data[0].url) return false
        const imageURL = response.data[0].url.toString()
        const allowedExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp']
        const imageExtension = imageURL.split('.').pop().toLowerCase()
        if (!imageURL || !allowedExtensions.includes(imageExtension) ||
            await bot.getFileSize(imageURL) > maxFileSize)
        {
            return false
        }

        return imageURL
    } catch (e) {
        console.error(e)
        return false
    }

}

module.exports = {getRandomImage}