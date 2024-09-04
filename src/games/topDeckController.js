const {topDeck: topDeckController} = require("./topDeck")
const {drawBattlefield} = require("../controller/canvasManager")
const fs = require("fs")
const {Formatters} = require('discord.js')

/**
 *
 * @param user
 * @param command
 * @param message
 * @returns {Promise<*>}
 */
async function handleTD(user, command, message) {
    console.log('starting top deck game')
    let td = await topDeckController(message.channelId, user, command)
    if (td.state === 'open')
    {
        let unitType = ''
        if (td.unitType) unitType = td.unitType + ' battle\n'

        return message.channel.send(
            unitType.toUpperCase() +
            'Waiting for another player...')
    }
    if (td.state === 'finished')
    {
        //draw the image
        message.channel.send('getting battle results...')
        try {
            const battleImage = await drawBattlefield(td)
            await message.channel.send({content: td.log, files: [battleImage]})
            message.channel.send(Formatters.userMention(td.player1))
            console.log(td.log)
            //delete the battle image
            fs.rm(battleImage, function ()
            {
                console.log('image deleted')
            })
        } catch (e) {
            message.channel.send('could not draw battle image\n' + td.log)
            console.error(e.toString())
        }
    }

    return true
}

module.exports = {handleTD}

