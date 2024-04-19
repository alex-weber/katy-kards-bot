const {topDeck: topDeckController} = require("./topDeck")
const {drawBattlefield} = require("../controller/canvasManager")
const fs = require("fs")

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

        return message.reply(
            unitType.toUpperCase() +
            'Waiting for another player...')
    }
    if (td.state === 'finished')
    {
        //draw the image
        message.reply('getting battle results...')
        try {
            const battleImage = await drawBattlefield(td)
            await message.reply({content: td.log, files: [battleImage]})
            console.log(td.log)
            //delete the battle image
            fs.rm(battleImage, function ()
            {
                console.log('image deleted')
            })
        } catch (e) {
            message.reply('could not draw battle image\n' + td.log)
            console.error(e.toString())
        }
    }

    return true
}

module.exports = {handleTD}

