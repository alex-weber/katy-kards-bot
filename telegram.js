
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
            Input.fromURLStream(value.attachment)
        )
    }

    return mediaGroup
}

module.exports = {telegramClient, telegramMessage, Input, getMediaGroup}