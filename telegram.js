
const {Telegraf, Input} = require('telegraf')
let {message} = require('telegraf/filters')

let telegramClient = false
if (process.env.TELEGRAM_TOKEN !== undefined) telegramClient = new Telegraf(process.env.TELEGRAM_TOKEN)
let telegramMessage = message

/**
 *
 * @param files
 * @returns {*[]}
 */
function getMediaGroup(files) {
    let mediaGroup = []
    for (const [, value] of Object.entries(files)) {
        if (value.attachment !== undefined) mediaGroup.push(
            {
                type: 'photo',
                media: value.attachment + '?' + new Date().getTime().toString(), //add timestamp as param to bypass cache
                caption: value.description,
            }
        )
    }

    return mediaGroup
}

module.exports = {telegramClient, telegramMessage, Input, getMediaGroup}