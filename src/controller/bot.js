const { PermissionsBitField } = require('discord.js')
const {updateUser} = require("../database/db")
const {languages} = require("../tools/language")
const axios = require("axios")

const deckCodeRegEx = /%%\d{2}\|(\w*;){1,3}\w*/

/**
 *
 * @param message
 * @returns {string|string}
 */
function getPrefix(message) {
    let prefix = process.env.DEFAULT_PREFIX || '!'
    //check for a different prefix
    let serverPrefix = process.env['PREFIX_' + message.guildId]
    if (serverPrefix !== undefined) prefix = serverPrefix

    return prefix
}

/**
 *
 * @param message
 * @returns {*|boolean}
 */
function isQuotationSearch(message)
{
    //check if it's a link (false detection)
    if (message.content.startsWith('http')) return false

    let botCommand = /(^%.+%)|([^0-9]+%.+%)/
    if (botCommand.test(message.content))
    {
        let arr = message.content.split('%')
        if (arr[1] !== undefined ) return arr[1]

    }

    return false
}

/**
 *
 * @param client
 * @param message
 * @param redis
 * @returns {Promise<boolean>}
 */
async function hasWritePermissions(client, message, redis)
{
    if (!message.guildId) return true
    let key = 'permissions:' + message.guildId + ':' + message.channelId
    if (await redis.exists(key))
    {
        //console.log('serving permissions from redis')
        const permission = await redis.get(key)

        return permission === 'yes'
    }

    const clientMember = await message.guild.members.fetch(client.user.id)
    let permissions = message.channel.permissionsFor(clientMember)

    if (!permissions ||
        !permissions.has(PermissionsBitField.Flags.SendMessages) ||
        !permissions.has(PermissionsBitField.Flags.AttachFiles))
    {
        console.log('no write permissions. Caching it')
        await redis.set(key, 'no')

        return false
    }

    console.log('has write permissions. Caching it')
    await redis.set(key, 'yes')

    return true
}

/**
 *
 * @param prefix
 * @param command
 * @returns {string}
 */
function parseCommand(prefix, command)
{
    //if it's double prefix set the command to online
    if (command === prefix + prefix) return 'online'
    //remove all duplicates od prefix
    while (command.startsWith(prefix)) command = command.replace(prefix, '')

    return command.trim().toLowerCase()
}

/**
 *
 * @param user
 * @param command
 * @returns {Promise<string>}
 */
async function switchLanguage(user, command)
{
    let language = command.slice(0, 2)
    user.language = language
    await updateUser(user)

    return language
}

/**
 *
 * @param command
 * @returns {Boolean}
 */
function isLanguageSwitch(command)
{
    return languages.includes(command)
}

/**
 *
 * @param url
 * @returns {Promise<Integer>}
 */
async function getFileSize(url)
{
    const response = await axios.head(url, { responseType: 'json' })
    //return 0 if the content-length header is not set
    if (!response.headers.has('content-length')) return 0
    const fileSize = parseInt(response.headers["content-length"])
    console.log(url, fileSize)

    return fileSize

}

/**
 *
 * @param command
 * @returns {boolean}
 */
function isDeckLink(command)
{
    return (command.startsWith('https://www.kards.com/') &&
        command.indexOf('/decks/') !== -1)
}

/**
 *
 * @param command
 * @returns {boolean}
 */
function isDeckCode(command)
{
    return deckCodeRegEx.test(command)
}
/**
 *
 * @param command
 * @returns {string}
 */
function getDeckCode(command)
{
    const match = deckCodeRegEx.exec(command)

    if (!match)
        return command

    console.log(match[0])

    return match[0]
}

/**
 *
 * @returns {string}
 */
function getCurrentTimestamp() {
    return new Date().getTime().toString()
}

/**
 *
 * @returns {number}
 */
function getMidnight()
{
    const midnight = new Date()
    midnight.setDate(midnight.getDate() + 1) //add one day
    midnight.setUTCHours(0, 0, 0, 0) //set hours to zero

    return midnight.getTime() / 1000
}

function getUTC()
{
    const now = new Date()
    const day = String(now.getUTCDate()).padStart(2, '0')
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const year = now.getUTCFullYear()
    const hours = String(now.getUTCHours()).padStart(2, '0')
    const minutes = String(now.getUTCMinutes()).padStart(2, '0')
    const seconds = String(now.getUTCSeconds()).padStart(2, '0')

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

module.exports = {
    getPrefix,
    isQuotationSearch,
    hasWritePermissions,
    parseCommand,
    switchLanguage,
    isLanguageSwitch,
    getFileSize,
    isDeckLink,
    isDeckCode,
    getDeckCode,
    getCurrentTimestamp,
    getMidnight,
    getUTC,
}