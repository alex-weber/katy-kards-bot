const axios = require("axios")

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

    return response.status === 200 ? response.data.url.toString() : false


}

module.exports = {getRandomImage}