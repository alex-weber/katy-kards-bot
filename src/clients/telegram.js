
const {Telegraf, Input } = require('telegraf')
const {message} = require('telegraf/filters')

let telegramClient = false
if (process.env.TELEGRAM_TOKEN !== undefined) telegramClient = new Telegraf(process.env.TELEGRAM_TOKEN)
const telegramMessage = message

function onTelegramError(err) {
    console.error('telegramAPI error occurred:', err)

    if (err.on?.payload?.chat_id) {
        telegramClient.telegram
            .sendMessage(err.on.payload.chat_id, 'Error: file upload failed')
            .then()
    }
}

/**
 *
 * @param files
 * @returns {*[]}
 */
function getMediaGroup(files) {
    const mediaGroup = []

    for (const value of files) {
        if (!value.attachment) continue

        mediaGroup.push({
            type: 'photo',
            media: value.isTelegramFileId
                ? value.attachment
                : Input.fromLocalFile(value.attachment),
            caption: value.description || ''
        })
    }

    return mediaGroup
}

module.exports = {
    telegramClient,
    telegramMessage,
    getMediaGroup,
    onTelegramError,
    Input,
}