const axios = require("axios")
const bot = require("../controller/bot")
const maxFileSize = 5 * 1024 * 1024 //5MB
/**
 *
 * @param endpoint
 * @returns {Promise<string|boolean>}
 */
async function getRandomImage(endpoint=false)
{
    if (!endpoint) endpoint = getRandomEndpoint()
    try {
        const response = await axios.get(`https://nekos.life/api/v2/img/${endpoint}`)
        if (response.status !== 200) return false
    } catch (e) {
        console.error(e)
        return false
    }
    const imageURL = response.data.url.toString()
    const allowedExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp']
    const imageExtension = imageURL.split('.').pop().toLowerCase()
    if (!imageURL || !allowedExtensions.includes(imageExtension) ||
        await bot.getFileSize(imageURL) > maxFileSize)
    {
        return false
    }

    return imageURL
}

function getRandomEndpoint()
{
    //get a random cat|dog image for no result
    let endpoints = ['meow', 'woof']
    //define the sample function to get a random array value
    Array.prototype.sample = function ()
    {
        return this[Math.floor(Math.random() * this.length)]
    }
    return endpoints.sample()
}

module.exports = {getRandomImage}