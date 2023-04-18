
import { Telegraf } from 'telegraf'
import { message as telegramMessage } from 'telegraf/filters'

let telegramBot = false
if (process.env.TELEGRAM_TOKEN !== undefined) telegramBot = new Telegraf(process.env.TELEGRAM_TOKEN)

module.exports = {telegramBot, telegramMessage}