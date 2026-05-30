
const {Telegraf, Input } = require('telegraf')
const {message} = require('telegraf/filters')
const fs = require('fs')

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
    let mediaGroup = []
    for (const [, value] of Object.entries(files)) {
        if (value.attachment !== undefined) {
            const stream = fs.createReadStream(value.attachment)
            // Clean up file descriptor when the stream ends or errors
            stream.once('close', () => stream.destroy())
            stream.once('error', (err) => {
                console.error('Telegram Stream error:', err)
                stream.destroy()
            })
            mediaGroup.push(
                {
                    type: 'photo',
                    media: { source: stream },
                    caption: value.description ? value.description : '',
                }
            )
        }
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