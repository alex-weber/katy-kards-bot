const axios = require("axios")
const bot = require("../controller/bot")
const maxFileSize = 5 * 1024 * 1024 //5MB
async function getRandomImage()
{
    //get a random cat|dog image for no result
    let endpoints = ['meow', 'woof']
    //define the sample function to get a random array value
    Array.prototype.sample = function ()
    {
        return this[Math.floor(Math.random() * this.length)]
    }
    const endpoint = endpoints.sample()
    const response = await axios.get(`https://nekos.life/api/v2/img/${endpoint}`)
    if (response.status !== 200) return false
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

module.exports = {getRandomImage}