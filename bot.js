const {Permissions} = require("discord.js")
const {updateUser} = require("./db")
const {translate} = require("./translator")
const {languages} = require("./language");

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
    let botCommand = /\".+\"/gm
    if (botCommand.test(message.content))
    {
        let arr = message.content.split('"')
        if (arr[1] !== undefined ) return arr[1]

    }

    return false
}

/**
 *
 * @param client
 * @param message
 * @returns {boolean}
 */
async function hasWritePermissions(client, message)
{
    const clientMember = await message.guild.members.fetch(client.user.id)
    let permissions = message.channel.permissionsFor(clientMember)
    if (!permissions || !permissions.has(Permissions.FLAGS.SEND_MESSAGES) ||
        !permissions.has(Permissions.FLAGS.ATTACH_FILES))
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

async function switchLanguage(user, command)
{
    let language = command.slice(0, 2)
    //for traditional chinese
    if (language === 'tw') language = 'zh-Hant'
    user.language = language

    await updateUser(user)

    return language
}

function isLanguageSwitch(command)
{
    return languages.includes(command)
}

module.exports = {getPrefix, isQuotationSearch, hasWritePermissions, parseCommand, switchLanguage, isLanguageSwitch}