const {Permissions} = require("discord.js")
const {updateUser} = require("./db")
const {languages} = require("./language")
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
 * @returns Promise {boolean}
 */
async function hasWritePermissions(client, message)
{
    const clientMember = await message.guild.members.fetch(client.user.id)
    let permissions = message.channel.permissionsFor(clientMember)
    if (!permissions || ! await permissions.has(Permissions.FLAGS.SEND_MESSAGES) ||
        ! await permissions.has(Permissions.FLAGS.ATTACH_FILES))
    {
        console.log('no write permissions.')

        return false
    } else return true


}

/**
 *
 * @param prefix
 * @param command
 * @returns {string}
 */
function parseCommand(prefix, command)
{
    while (command.startsWith(prefix)) command = command.replace(prefix, '')
    command = command.trim().toLowerCase()

    return command
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