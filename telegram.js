
const {Telegraf} = require('telegraf')
let {message} = require('telegraf/filters')

let telegramBot = false
if (process.env.TELEGRAM_TOKEN !== undefined) telegramBot = new Telegraf(process.env.TELEGRAM_TOKEN)
let telegramMessage = message
module.exports = {telegramBot, telegramMessage}