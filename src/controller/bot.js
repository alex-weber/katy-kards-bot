const {Permissions} = require("discord.js")
const {updateUser} = require("../database/db")
const {languages} = require("../tools/language")
const axios = require("axios")

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

    let botCommand = /[^0-9]+%.+%/
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
    if (await redis.exists(message.guildId+message.channelId))
    {
        //console.log('serving permissions from redis')
        return await redis.get(message.guildId + message.channelId)
    }
    const clientMember = await message.guild.members.fetch(client.user.id)
    let permissions = message.channel.permissionsFor(clientMember)
    if (!permissions || ! await permissions.has(Permissions.FLAGS.SEND_MESSAGES) ||
        ! await permissions.has(Permissions.FLAGS.ATTACH_FILES))
    {
        console.log('no write permissions. Caching it')
        await redis.set(message.guildId+message.channelId, false)
        return false
    } else
    {
        console.log('has write permissions. Caching it')
        redis.set(message.guildId+message.channelId, 1)
        return true
    }


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

module.exports = {
    getPrefix,
    isQuotationSearch,
    hasWritePermissions,
    parseCommand,
    switchLanguage,
    isLanguageSwitch,
    getFileSize,
}